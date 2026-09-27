// Writes downloaded piece/block data to disk at the right place, for both
// single-file and multi-file torrents. A single piece (or even a single
// block) can straddle two files in a multi-file torrent, since files are
// just concatenated conceptually before being cut into fixed-size pieces —
// so every write here is expressed as a global offset into that
// concatenation and split across underlying files as needed.
import fs from "node:fs";
import path from "node:path";
import { Bittorrent, is_single_file_bittorrent, SingleFileInfo, MultipleFilesInfo } from "./bittorrent.js";

type FileSpan = {
  abs_path: string;
  start: number; // inclusive, global offset
  end: number; // exclusive, global offset
};

export class TorrentFileWriter {
  private spans: FileSpan[];
  private fds: Map<string, number> = new Map();

  private constructor(spans: FileSpan[]) {
    this.spans = spans;
  }

  // Computes the file layout and creates (or resizes) every underlying
  // file to its full final size, so writes at arbitrary offsets are valid
  // (some platforms require the file to already exist to seek-write past
  // its current end).
  static open(torrent: Bittorrent, out_dir: string): TorrentFileWriter {
    const spans: FileSpan[] = [];
    let offset = 0;

    if (is_single_file_bittorrent(torrent)) {
      const info = torrent.info as SingleFileInfo;
      const abs_path = path.join(out_dir, info.name);
      fs.mkdirSync(path.dirname(abs_path), { recursive: true });
      spans.push({ abs_path, start: 0, end: info.len });
    } else {
      const info = torrent.info as MultipleFilesInfo;
      for (const f of info.files) {
        const abs_path = path.join(out_dir, info.dest_dir, ...f.path);
        fs.mkdirSync(path.dirname(abs_path), { recursive: true });
        spans.push({ abs_path, start: offset, end: offset + f.len });
        offset += f.len;
      }
    }

    const writer = new TorrentFileWriter(spans);
    for (const span of spans) {
      // Create the file if it doesn't yet exist, without truncating an
      // existing partial download (useful once resume support exists).
      // Important: must NOT open with "a"/"a+" — that implies O_APPEND,
      // which makes every write ignore the explicit position argument
      // below and always append to the end instead.
      if (!fs.existsSync(span.abs_path)) {
        fs.closeSync(fs.openSync(span.abs_path, "w"));
      }
      const fd = fs.openSync(span.abs_path, "r+");
      fs.ftruncateSync(fd, span.end - span.start);
      writer.fds.set(span.abs_path, fd);
    }
    return writer;
  }

  // Writes `data` starting at global offset `offset`, splitting it across
  // however many underlying files it spans.
  write_at(offset: number, data: Uint8Array): void {
    const end = offset + data.length;

    for (const span of this.spans) {
      if (span.end <= offset || span.start >= end) continue; // no overlap
      const overlap_start = Math.max(span.start, offset);
      const overlap_end = Math.min(span.end, end);
      const chunk = data.slice(overlap_start - offset, overlap_end - offset);
      const fd = this.fds.get(span.abs_path)!;
      fs.writeSync(fd, chunk, 0, chunk.length, overlap_start - span.start);
    }
  }

  close(): void {
    for (const fd of this.fds.values()) {
      fs.closeSync(fd);
    }
    this.fds.clear();
  }
}
