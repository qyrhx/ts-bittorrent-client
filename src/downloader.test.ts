// End-to-end test: a real net.Server plays a well-behaved peer serving
// real piece data (including a deliberately corrupt piece in one test),
// and we drive the actual PeerConnection + download_from_peer against it,
// then check the bytes written to disk.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import c from "node:crypto";
import { PeerConnection } from "./peer_conn.js";
import * as pw from "./peer_wire.js";
import { download_from_peer } from "./downloader.js";
import { Bittorrent, SingleFileInfo } from "./bittorrent.js";
import { BLOCK_SIZE, blocks_for_piece } from "./piece_manager.js";

const INFO_HASH = new Uint8Array(20).fill(0xaa);
const MY_PEER_ID = new Uint8Array(20).fill(0x01);
const REMOTE_PEER_ID = new Uint8Array(20).fill(0x02);

function tmp_dir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "btdownload-"));
}

function sha1(data: Uint8Array): Uint8Array {
  return c.createHash("sha1").update(data).digest();
}

// Starts a fake peer that: completes the handshake, immediately sends an
// all-ones bitfield + unchoke, then serves any `request` with the
// corresponding slice of `file_data` (or a deliberately wrong block if
// `corrupt_piece` matches, to test hash-verification failure).
function start_fake_seeder(file_data: Uint8Array, piece_len: number, opts: { corrupt_piece?: number } = {}) {
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((sock) => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));

      let buffered: Uint8Array = new Uint8Array(0);
      let handshake_done = false;
      const num_pieces = Math.ceil(file_data.length / piece_len);

      sock.on("data", (chunk: Buffer) => {
        buffered = concat(buffered, new Uint8Array(chunk));

        if (!handshake_done) {
          if (buffered.length < 68) return;
          const [, consumed] = pw.decode_handshake(buffered);
          buffered = buffered.slice(consumed);
          handshake_done = true;
          sock.write(Buffer.from(pw.encode_handshake(INFO_HASH, REMOTE_PEER_ID)));
          const bitfield = new Uint8Array(Math.ceil(num_pieces / 8)).fill(0xff);
          sock.write(Buffer.from(pw.encode_message({ kind: "bitfield", bitfield })));
          sock.write(Buffer.from(pw.encode_message({ kind: "unchoke" })));
        }

        const { frames, rest } = pw.extract_frames(buffered);
        buffered = rest;
        for (const frame of frames) {
          const msg = pw.decode_message(frame);
          if (msg.kind === "request") {
            const global_offset = msg.index * piece_len + msg.begin;
            let block = file_data.slice(global_offset, global_offset + msg.length);
            if (opts.corrupt_piece === msg.index) {
              block = new Uint8Array(block.length).fill(0xff); // guaranteed wrong
            }
            sock.write(Buffer.from(pw.encode_message({ kind: "piece", index: msg.index, begin: msg.begin, block })));
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("expected AddressInfo");
      resolve({
        port: addr.port,
        close: () =>
          new Promise((res) => {
            for (const sock of sockets) sock.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const res = new Uint8Array(a.length + b.length);
  res.set(a, 0);
  res.set(b, a.length);
  return res;
}

function make_single_file_torrent(name: string, file_data: Uint8Array, piece_len: number): Bittorrent {
  const num_pieces = Math.ceil(file_data.length / piece_len);
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < num_pieces; i++) {
    const start = i * piece_len;
    pieces.push(sha1(file_data.slice(start, start + piece_len)));
  }
  const info: SingleFileInfo = { len: file_data.length, name, piece_len, pieces };
  return { announce: "http://example.com/announce", info };
}

describe("download_from_peer", () => {
  it("downloads a small multi-piece file and writes correct bytes to disk", async () => {
    const piece_len = BLOCK_SIZE * 2 + 100; // deliberately not a multiple of BLOCK_SIZE
    const file_data = c.randomBytes(piece_len * 3 + 777); // several pieces, uneven last piece
    const torrent = make_single_file_torrent("data.bin", file_data, piece_len);

    const { port, close } = await start_fake_seeder(file_data, piece_len);
    const out_dir = tmp_dir();
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      const progress: number[] = [];
      await download_from_peer(torrent, conn, out_dir, {
        unchoke_timeout_ms: 2000,
        block_timeout_ms: 2000,
        on_progress: (idx) => progress.push(idx),
      });
      conn.close();

      const written = fs.readFileSync(path.join(out_dir, "data.bin"));
      assert.deepEqual(new Uint8Array(written), new Uint8Array(file_data));
      assert.equal(progress.length, torrent.info.pieces.length);
    } finally {
      await close();
    }
  });

  it("downloads a file smaller than one block", async () => {
    const piece_len = 100;
    const file_data = c.randomBytes(37);
    const torrent = make_single_file_torrent("tiny.bin", file_data, piece_len);

    const { port, close } = await start_fake_seeder(file_data, piece_len);
    const out_dir = tmp_dir();
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      await download_from_peer(torrent, conn, out_dir, { unchoke_timeout_ms: 2000, block_timeout_ms: 2000 });
      conn.close();

      const written = fs.readFileSync(path.join(out_dir, "tiny.bin"));
      assert.deepEqual(new Uint8Array(written), new Uint8Array(file_data));
    } finally {
      await close();
    }
  });

  it("rejects when a piece fails hash verification", async () => {
    const piece_len = 500;
    const file_data = c.randomBytes(piece_len * 2);
    const torrent = make_single_file_torrent("bad.bin", file_data, piece_len);

    const { port, close } = await start_fake_seeder(file_data, piece_len, { corrupt_piece: 1 });
    const out_dir = tmp_dir();
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      await assert.rejects(
        download_from_peer(torrent, conn, out_dir, { unchoke_timeout_ms: 2000, block_timeout_ms: 2000 }),
        /hash verification/
      );
      conn.close();
    } finally {
      await close();
    }
  });

  it("rejects if the peer never unchokes us", async () => {
    // A minimal fake peer that handshakes but never sends bitfield/unchoke.
    const { port, close } = await new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
      const sockets = new Set<net.Socket>();
      const server = net.createServer((sock) => {
        sockets.add(sock);
        sock.on("close", () => sockets.delete(sock));
        sock.once("data", () => {
          sock.write(Buffer.from(pw.encode_handshake(INFO_HASH, REMOTE_PEER_ID)));
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr === null || typeof addr === "string") throw new Error("expected AddressInfo");
        resolve({
          port: addr.port,
          close: () =>
            new Promise((res) => {
              for (const sock of sockets) sock.destroy();
              server.close(() => res());
            }),
        });
      });
    });

    const torrent = make_single_file_torrent("x.bin", new Uint8Array(10), 100);
    const out_dir = tmp_dir();
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      await assert.rejects(
        download_from_peer(torrent, conn, out_dir, { unchoke_timeout_ms: 200, block_timeout_ms: 200 }),
        /timed out waiting for unchoke/
      );
      conn.close();
    } finally {
      await close();
    }
  });
});
