import { describe, it } from "node:test";
import assert from "node:assert/strict";
import c from "node:crypto";
import {
  BLOCK_SIZE,
  blocks_for_piece,
  piece_length_for,
  verify_piece,
  parse_bitfield,
  PieceAssembler,
} from "./piece_manager.js";
import { Bittorrent, SingleFileInfo } from "./bittorrent.js";

const throws = (fn: () => unknown) => assert.throws(fn);

function make_torrent(total_len: number, piece_len: number): Bittorrent {
  const num_pieces = Math.ceil(total_len / piece_len);
  const pieces = Array.from({ length: num_pieces }, () => new Uint8Array(20));
  const info: SingleFileInfo = { len: total_len, name: "f", piece_len, pieces };
  return { announce: "http://example.com", info };
}

describe("blocks_for_piece", () => {
  it("splits an exact multiple of BLOCK_SIZE into equal blocks", () => {
    const blocks = blocks_for_piece(BLOCK_SIZE * 3);
    assert.deepEqual(blocks, [
      { begin: 0, length: BLOCK_SIZE },
      { begin: BLOCK_SIZE, length: BLOCK_SIZE },
      { begin: BLOCK_SIZE * 2, length: BLOCK_SIZE },
    ]);
  });

  it("gives a shorter last block for a non-multiple length", () => {
    const blocks = blocks_for_piece(BLOCK_SIZE + 100);
    assert.deepEqual(blocks, [
      { begin: 0, length: BLOCK_SIZE },
      { begin: BLOCK_SIZE, length: 100 },
    ]);
  });

  it("returns a single short block for a piece smaller than BLOCK_SIZE", () => {
    assert.deepEqual(blocks_for_piece(500), [{ begin: 0, length: 500 }]);
  });
});

describe("piece_length_for", () => {
  it("returns piece_len for every piece except the last", () => {
    const t = make_torrent(BLOCK_SIZE * 10 + 500, BLOCK_SIZE * 3);
    assert.equal(piece_length_for(t, 0), BLOCK_SIZE * 3);
    assert.equal(piece_length_for(t, 1), BLOCK_SIZE * 3);
  });

  it("returns the remainder for the last piece", () => {
    const piece_len = 1000;
    const total = piece_len * 4 + 137;
    const t = make_torrent(total, piece_len);
    const last_index = t.info.pieces.length - 1;
    assert.equal(piece_length_for(t, last_index), 137);
  });

  it("returns the full piece_len when total is an exact multiple", () => {
    const piece_len = 1000;
    const t = make_torrent(piece_len * 4, piece_len);
    assert.equal(piece_length_for(t, 3), piece_len);
  });

  it("throws on an out-of-range index", () => {
    const t = make_torrent(1000, 500);
    throws(() => piece_length_for(t, -1));
    throws(() => piece_length_for(t, 2));
  });
});

describe("verify_piece", () => {
  it("returns true for matching data", () => {
    const data = Uint8Array.of(1, 2, 3, 4);
    const hash = c.createHash("sha1").update(data).digest();
    assert.equal(verify_piece(data, hash), true);
  });

  it("returns false for mismatched data", () => {
    const data = Uint8Array.of(1, 2, 3, 4);
    const wrong_hash = c.createHash("sha1").update(Uint8Array.of(9, 9, 9)).digest();
    assert.equal(verify_piece(data, wrong_hash), false);
  });
});

describe("parse_bitfield", () => {
  it("parses a full byte MSB-first", () => {
    // 0b10110000 -> pieces 0, 2, 3 present (bits 4-7 are 0)
    const have = parse_bitfield(Uint8Array.of(0b10110000), 8);
    assert.deepEqual([...have].sort(), [0, 2, 3]);
  });

  it("ignores spare bits past num_pieces in the last byte", () => {
    // 5 pieces, so only the top 5 bits of the single byte matter
    const have = parse_bitfield(Uint8Array.of(0b11111111), 5);
    assert.deepEqual([...have].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  });

  it("handles multiple bytes", () => {
    const have = parse_bitfield(Uint8Array.of(0b00000001, 0b10000000), 16);
    assert.deepEqual([...have].sort((a, b) => a - b), [7, 8]);
  });

  it("returns an empty set for an all-zero bitfield", () => {
    assert.deepEqual(parse_bitfield(Uint8Array.of(0, 0), 16), new Set());
  });
});

describe("PieceAssembler", () => {
  it("is not complete until every block is filled", () => {
    const a = new PieceAssembler(0, BLOCK_SIZE * 2);
    assert.equal(a.is_complete(), false);
    a.add_block(0, new Uint8Array(BLOCK_SIZE).fill(1));
    assert.equal(a.is_complete(), false);
    a.add_block(BLOCK_SIZE, new Uint8Array(BLOCK_SIZE).fill(2));
    assert.equal(a.is_complete(), true);
  });

  it("places blocks at the correct offset", () => {
    const a = new PieceAssembler(0, 10);
    a.add_block(5, Uint8Array.of(9, 9, 9, 9, 9));
    a.add_block(0, Uint8Array.of(1, 2, 3, 4, 5));
    assert.deepEqual(a.data(), Uint8Array.of(1, 2, 3, 4, 5, 9, 9, 9, 9, 9));
  });

  it("throws when a block would run past the piece length", () => {
    const a = new PieceAssembler(0, 10);
    throws(() => a.add_block(8, new Uint8Array(5)));
  });

  it("throws on a negative begin", () => {
    const a = new PieceAssembler(0, 10);
    throws(() => a.add_block(-1, new Uint8Array(2)));
  });
});
