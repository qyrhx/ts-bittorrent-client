// These are integration tests against a real TCP socket: a throwaway
// net.Server on localhost plays the "peer" so we exercise actual
// handshake bytes and framing over the wire, not a mocked socket.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import { PeerConnection } from "./peer_conn.js";
import * as pw from "./peer_wire.js";

const INFO_HASH = new Uint8Array(20).fill(0xaa);
const OTHER_INFO_HASH = new Uint8Array(20).fill(0xbb);
const MY_PEER_ID = new Uint8Array(20).fill(0x01);
const REMOTE_PEER_ID = new Uint8Array(20).fill(0x02);

// Starts a bare TCP server on an ephemeral port and hands each connecting
// socket to `onSocket`. Returns the port and a close() to tear it down.
function startFakePeer(onSocket: (sock: net.Socket) => void): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = net.createServer(onSocket);
    const sockets = new Set<net.Socket>();
    server.on("connection", (sock) => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));
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

describe("PeerConnection.connect", () => {
  it("completes the handshake and reports the peer's peer_id", async () => {
    const { port, close } = await startFakePeer((sock) => {
      sock.once("data", () => {
        sock.write(Buffer.from(pw.encode_handshake(INFO_HASH, REMOTE_PEER_ID)));
      });
    });
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      assert.deepEqual(conn.remote_peer_id, REMOTE_PEER_ID);
      assert.equal(conn.am_choking, true);
      assert.equal(conn.peer_choking, true);
      conn.close();
    } finally {
      await close();
    }
  });

  it("rejects when the peer's info_hash doesn't match", async () => {
    const { port, close } = await startFakePeer((sock) => {
      sock.once("data", () => {
        sock.write(Buffer.from(pw.encode_handshake(OTHER_INFO_HASH, REMOTE_PEER_ID)));
      });
    });
    try {
      await assert.rejects(
        PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 }),
        /mismatched info_hash/
      );
    } finally {
      await close();
    }
  });

  it("rejects on connection refused (nothing listening)", async () => {
    // Port 1 is privileged/unused; connecting should fail fast.
    await assert.rejects(PeerConnection.connect("127.0.0.1", 1, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 }));
  });

  it("rejects on timeout when the peer never sends a handshake", async () => {
    const { port, close } = await startFakePeer(() => {
      // accept the connection but never write anything back
    });
    try {
      await assert.rejects(
        PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 200 }),
        /timed out/
      );
    } finally {
      await close();
    }
  });

  it("sends our handshake with the correct info_hash and peer_id", async () => {
    let received: Buffer = Buffer.alloc(0);
    const { port, close } = await startFakePeer((sock) => {
      sock.once("data", (chunk: Buffer) => {
        received = chunk;
        sock.write(Buffer.from(pw.encode_handshake(INFO_HASH, REMOTE_PEER_ID)));
      });
    });
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      const [hs] = pw.decode_handshake(new Uint8Array(received));
      assert.deepEqual(new Uint8Array(hs.info_hash), INFO_HASH);
      assert.deepEqual(new Uint8Array(hs.peer_id), MY_PEER_ID);
      conn.close();
    } finally {
      await close();
    }
  });
});

describe("PeerConnection message handling", () => {
  it("emits decoded messages arriving after the handshake, packed in the same chunk", async () => {
    const { port, close } = await startFakePeer((sock) => {
      sock.once("data", () => {
        const handshake = Buffer.from(pw.encode_handshake(INFO_HASH, REMOTE_PEER_ID));
        const bitfield = Buffer.from(pw.encode_message({ kind: "bitfield", bitfield: Uint8Array.of(0xff) }));
        const unchoke = Buffer.from(pw.encode_message({ kind: "unchoke" }));
        // Send handshake + two messages all in one TCP write, to exercise
        // the "leftover bytes after handshake in the same chunk" path.
        sock.write(Buffer.concat([handshake, bitfield, unchoke]));
      });
    });
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      const messages: pw.PeerMessage[] = await new Promise((resolve) => {
        const got: pw.PeerMessage[] = [];
        conn.on("message", (msg: pw.PeerMessage) => {
          got.push(msg);
          if (got.length === 2) resolve(got);
        });
      });
      assert.deepEqual(messages, [
        { kind: "bitfield", bitfield: Uint8Array.of(0xff) },
        { kind: "unchoke" },
      ]);
      assert.equal(conn.peer_choking, false); // updated automatically by the unchoke message
      conn.close();
    } finally {
      await close();
    }
  });

  it("emits messages arriving in separate chunks after the handshake", async () => {
    const { port, close } = await startFakePeer((sock) => {
      sock.once("data", () => {
        sock.write(Buffer.from(pw.encode_handshake(INFO_HASH, REMOTE_PEER_ID)));
        setTimeout(() => {
          sock.write(Buffer.from(pw.encode_message({ kind: "have", piece_index: 5 })));
        }, 20);
      });
    });
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      const msg = await new Promise<pw.PeerMessage>((resolve) => {
        conn.once("message", resolve);
      });
      assert.deepEqual(msg, { kind: "have", piece_index: 5 });
      conn.close();
    } finally {
      await close();
    }
  });

  it("send_interested marks am_interested and writes the correct bytes", async () => {
    let secondChunk: Buffer = Buffer.alloc(0);
    const { port, close } = await startFakePeer((sock) => {
      let n = 0;
      sock.on("data", (chunk: Buffer) => {
        n++;
        if (n === 1) {
          sock.write(Buffer.from(pw.encode_handshake(INFO_HASH, REMOTE_PEER_ID)));
        } else {
          secondChunk = chunk;
        }
      });
    });
    try {
      const conn = await PeerConnection.connect("127.0.0.1", port, INFO_HASH, MY_PEER_ID, { timeout_ms: 2000 });
      conn.send_interested();
      await new Promise((r) => setTimeout(r, 50)); // let the write land on the server
      assert.equal(conn.am_interested, true);
      assert.deepEqual(new Uint8Array(secondChunk), pw.encode_message({ kind: "interested" }));
      conn.close();
    } finally {
      await close();
    }
  });
});
