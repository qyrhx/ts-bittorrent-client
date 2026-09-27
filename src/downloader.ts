// Orchestrates downloading an entire torrent from a single peer:
// handshake -> interested/unchoke -> request each piece's blocks
// sequentially (stop-and-wait, one block in flight at a time) -> verify
// each piece's hash -> write it to disk.
//
// Deliberately simple for a first working version: one peer, pieces
// requested in order, one block at a time. No pipelining, no rarest-first
// selection, no parallel peers. That's real, meaningful download
// throughput left on the table — see the note at the end of main.ts.
import { PeerConnection } from "./peer_conn.js";
import * as pw from "./peer_wire.js";
import { Bittorrent } from "./bittorrent.js";
import { TorrentFileWriter } from "./file_writer.js";
import { blocks_for_piece, piece_length_for, verify_piece, parse_bitfield, PieceAssembler } from "./piece_manager.js";

export type DownloadOptions = {
  // Overall time to wait for the peer to unchoke us after we say we're interested.
  unchoke_timeout_ms?: number;
  // Time to wait for each individual block response.
  block_timeout_ms?: number;
  on_progress?: (piece_index: number, num_pieces: number) => void;
};

const DEFAULT_UNCHOKE_TIMEOUT_MS = 15_000;
const DEFAULT_BLOCK_TIMEOUT_MS = 15_000;

export async function download_from_peer(
  torrent: Bittorrent,
  conn: PeerConnection,
  out_dir: string,
  opts: DownloadOptions = {}
): Promise<void> {
  const unchoke_timeout_ms = opts.unchoke_timeout_ms ?? DEFAULT_UNCHOKE_TIMEOUT_MS;
  const block_timeout_ms = opts.block_timeout_ms ?? DEFAULT_BLOCK_TIMEOUT_MS;

  const info = torrent.info as Bittorrent["info"];
  const num_pieces = info.pieces.length;

  // `have` tracks which pieces the peer has told us about, via its initial
  // bitfield and/or incremental `have` messages. If the peer never sends
  // either (technically allowed if it has nothing yet), `have` stays empty
  // and we optimistically try every piece rather than downloading nothing.
  const have = new Set<number>();
  let got_bitfield_or_have = false;

  conn.on("message", (msg: pw.PeerMessage) => {
    if (msg.kind === "bitfield") {
      for (const idx of parse_bitfield(msg.bitfield, num_pieces)) have.add(idx);
      got_bitfield_or_have = true;
    } else if (msg.kind === "have") {
      have.add(msg.piece_index);
      got_bitfield_or_have = true;
    }
  });

  conn.send_interested();
  await wait_for(conn, (msg) => msg.kind === "unchoke", unchoke_timeout_ms, "unchoke");

  const writer = TorrentFileWriter.open(torrent, out_dir);
  try {
    for (let piece_index = 0; piece_index < num_pieces; piece_index++) {
      if (got_bitfield_or_have && !have.has(piece_index)) {
        throw new Error(
          `peer ${conn.ip}:${conn.port} does not have piece ${piece_index}; a single-peer download can't proceed`
        );
      }

      const piece_len = piece_length_for(torrent, piece_index);
      const assembler = new PieceAssembler(piece_index, piece_len);

      for (const block of blocks_for_piece(piece_len)) {
        const data = await request_block(conn, piece_index, block.begin, block.length, block_timeout_ms);
        assembler.add_block(block.begin, data);
      }

      const piece_data = assembler.data();
      const expected_hash = info.pieces[piece_index];
      if (!verify_piece(piece_data, expected_hash)) {
        throw new Error(`piece ${piece_index} failed hash verification`);
      }

      writer.write_at(piece_index * info.piece_len, piece_data);
      opts.on_progress?.(piece_index, num_pieces);
    }
  } finally {
    writer.close();
  }
}

function request_block(conn: PeerConnection, index: number, begin: number, length: number, timeout_ms: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      conn.off("message", on_message);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`timed out waiting for block (piece ${index}, begin ${begin})`));
    }, timeout_ms);

    const on_message = (msg: pw.PeerMessage) => {
      if (settled) return;
      if (msg.kind === "choke") {
        settled = true;
        cleanup();
        reject(new Error(`peer choked us while waiting for piece ${index}, begin ${begin}`));
      } else if (msg.kind === "piece" && msg.index === index && msg.begin === begin) {
        settled = true;
        cleanup();
        resolve(msg.block);
      }
    };

    conn.on("message", on_message);
    conn.request_block(index, begin, length);
  });
}

function wait_for(conn: PeerConnection, predicate: (msg: pw.PeerMessage) => boolean, timeout_ms: number, what: string): Promise<pw.PeerMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      conn.off("message", on_message);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`timed out waiting for ${what} from ${conn.ip}:${conn.port}`));
    }, timeout_ms);

    const on_message = (msg: pw.PeerMessage) => {
      if (settled) return;
      if (predicate(msg)) {
        settled = true;
        cleanup();
        resolve(msg);
      }
    };

    conn.on("message", on_message);
  });
}
