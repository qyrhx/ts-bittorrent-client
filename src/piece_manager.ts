// Pure piece/block bookkeeping: how a piece is split into block requests,
// verifying a completed piece's hash, and assembling incoming blocks into
// a piece buffer. No networking or disk I/O here — see peer_conn.ts and
// file_writer.ts for those.
import c from "node:crypto";
import { Bittorrent, SingleFileInfo, MultipleFilesInfo, total_length } from "./bittorrent.js";

// The de facto standard block size used by essentially all BitTorrent
// clients; peers commonly reject `request`s for larger blocks.
export const BLOCK_SIZE = 16384;

export type BlockRequest = {
  begin: number;
  length: number;
};

// The last piece of a torrent is usually shorter than `piece_len`, since
// the total length rarely divides evenly.
export function piece_length_for(torrent: Bittorrent, piece_index: number): number {
  const info = torrent.info as SingleFileInfo | MultipleFilesInfo;
  const num = info.pieces.length;
  if (piece_index < 0 || piece_index >= num) {
    throw new Error(`piece index ${piece_index} out of range (0..${num - 1})`);
  }
  if (piece_index < num - 1) {
    return info.piece_len;
  }
  const remainder = total_length(torrent) - info.piece_len * (num - 1);
  return remainder;
}

export function blocks_for_piece(piece_len: number): BlockRequest[] {
  const blocks: BlockRequest[] = [];
  for (let begin = 0; begin < piece_len; begin += BLOCK_SIZE) {
    blocks.push({ begin, length: Math.min(BLOCK_SIZE, piece_len - begin) });
  }
  return blocks;
}

export function verify_piece(data: Uint8Array, expected_hash: Uint8Array): boolean {
  const actual = c.createHash("sha1").update(data).digest();
  if (actual.length !== expected_hash.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected_hash[i]) return false;
  }
  return true;
}

// Decodes a peer's `bitfield` message payload into the set of piece
// indices it claims to have. Bits are packed MSB-first within each byte;
// trailing spare bits in the last byte (when num_pieces isn't a multiple
// of 8) are ignored.
export function parse_bitfield(bitfield: Uint8Array, num_pieces: number): Set<number> {
  const have = new Set<number>();
  for (let i = 0; i < num_pieces; i++) {
    const byte = bitfield[Math.floor(i / 8)];
    if (byte === undefined) break;
    const bit = 7 - (i % 8);
    if ((byte >> bit) & 1) have.add(i);
  }
  return have;
}

// Accumulates blocks for a single in-flight piece. Blocks may arrive in
// any order (though the downloader in this project requests them
// sequentially); `is_complete()` only reports true once every byte of the
// piece has actually been written.
export class PieceAssembler {
  readonly piece_index: number;
  readonly piece_len: number;
  private buffer: Uint8Array;
  private filled: boolean[]; // one entry per BLOCK_SIZE-sized slot

  constructor(piece_index: number, piece_len: number) {
    this.piece_index = piece_index;
    this.piece_len = piece_len;
    this.buffer = new Uint8Array(piece_len);
    this.filled = new Array(Math.ceil(piece_len / BLOCK_SIZE)).fill(false);
  }

  add_block(begin: number, data: Uint8Array): void {
    if (begin < 0 || begin + data.length > this.piece_len) {
      throw new Error(
        `block [${begin}, ${begin + data.length}) out of bounds for piece of length ${this.piece_len}`
      );
    }
    this.buffer.set(data, begin);
    this.filled[Math.floor(begin / BLOCK_SIZE)] = true;
  }

  is_complete(): boolean {
    return this.filled.every((f) => f);
  }

  data(): Uint8Array {
    return this.buffer;
  }
}
