// src/file_writer.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TorrentFileWriter } from "./file_writer.js";
import { Bittorrent, SingleFileInfo, MultipleFilesInfo } from "./bittorrent.js";

function tmp_dir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "btwriter-"));
}

function single_file_torrent(name: string, len: number): Bittorrent {
  const info: SingleFileInfo = { len, name, piece_len: 1000, pieces: [] };
  return { announce: "http://x", info };
}

function multi_file_torrent(dest_dir: string, files: { path: string[]; len: number }[]): Bittorrent {
  const info: MultipleFilesInfo = { files, dest_dir, piece_len: 1000, pieces: [] };
  return { announce: "http://x", info };
}

describe("TorrentFileWriter (single-file)", () => {
  it("creates the file at the right size and writes at an offset", () => {
    const dir = tmp_dir();
    const t = single_file_torrent("movie.mp4", 20);
    const w = TorrentFileWriter.open(t, dir);
    w.write_at(5, Uint8Array.of(1, 2, 3));
    w.close();

    const out = fs.readFileSync(path.join(dir, "movie.mp4"));
    assert.equal(out.length, 20);
    assert.deepEqual(new Uint8Array(out.slice(5, 8)), Uint8Array.of(1, 2, 3));
    // untouched bytes should be zero-filled
    assert.deepEqual(new Uint8Array(out.slice(0, 5)), new Uint8Array(5));
  });

  it("creates nested destination directories", () => {
    const dir = tmp_dir();
    const nested = path.join(dir, "a", "b");
    const t = single_file_torrent("f.bin", 4);
    const w = TorrentFileWriter.open(t, nested);
    w.write_at(0, Uint8Array.of(9, 9, 9, 9));
    w.close();
    assert.equal(fs.readFileSync(path.join(nested, "f.bin")).length, 4);
  });
});

describe("TorrentFileWriter (multi-file)", () => {
  it("routes a write entirely within one file", () => {
    const dir = tmp_dir();
    const t = multi_file_torrent("MyTorrent", [
      { path: ["a.txt"], len: 10 },
      { path: ["b.txt"], len: 10 },
    ]);
    const w = TorrentFileWriter.open(t, dir);
    w.write_at(12, Uint8Array.of(7, 7)); // offset 12 = b.txt byte 2..3
    w.close();

    const a = fs.readFileSync(path.join(dir, "MyTorrent", "a.txt"));
    const b = fs.readFileSync(path.join(dir, "MyTorrent", "b.txt"));
    assert.equal(a.length, 10);
    assert.equal(b.length, 10);
    assert.deepEqual(new Uint8Array(b.slice(2, 4)), Uint8Array.of(7, 7));
    assert.deepEqual(new Uint8Array(a), new Uint8Array(10));
  });

  it("splits a write that straddles two files", () => {
    const dir = tmp_dir();
    const t = multi_file_torrent("T", [
      { path: ["first.bin"], len: 5 },
      { path: ["second.bin"], len: 5 },
    ]);
    const w = TorrentFileWriter.open(t, dir);
    // global offset 3, length 4 -> bytes [3,4] of first.bin, bytes [0,1] of second.bin
    w.write_at(3, Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd));
    w.close();

    const first = fs.readFileSync(path.join(dir, "T", "first.bin"));
    const second = fs.readFileSync(path.join(dir, "T", "second.bin"));
    assert.deepEqual(new Uint8Array(first.slice(3, 5)), Uint8Array.of(0xaa, 0xbb));
    assert.deepEqual(new Uint8Array(second.slice(0, 2)), Uint8Array.of(0xcc, 0xdd));
  });

  it("splits a write across three files", () => {
    const dir = tmp_dir();
    const t = multi_file_torrent("T", [
      { path: ["1.bin"], len: 2 },
      { path: ["2.bin"], len: 2 },
      { path: ["3.bin"], len: 2 },
    ]);
    const w = TorrentFileWriter.open(t, dir);
    // covers all of file 2 (offset 2-3) plus one byte into files 1 and 3
    w.write_at(1, Uint8Array.of(1, 2, 2, 3));
    w.close();

    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir, "T", "1.bin"))), Uint8Array.of(0, 1));
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir, "T", "2.bin"))), Uint8Array.of(2, 2));
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir, "T", "3.bin"))), Uint8Array.of(3, 0));
  });

  it("handles nested path segments", () => {
    const dir = tmp_dir();
    const t = multi_file_torrent("Album", [{ path: ["disc1", "track1.mp3"], len: 3 }]);
    const w = TorrentFileWriter.open(t, dir);
    w.write_at(0, Uint8Array.of(1, 2, 3));
    w.close();
    assert.deepEqual(
      new Uint8Array(fs.readFileSync(path.join(dir, "Album", "disc1", "track1.mp3"))),
      Uint8Array.of(1, 2, 3)
    );
  });
});
