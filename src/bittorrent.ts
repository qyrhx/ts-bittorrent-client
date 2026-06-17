import * as bc from "./bencode.js";
import * as u from "./utils.js"
import fs from "node:fs";
import c from "node:crypto";

export type Bittorrent = {
  announce: string,
  info: SingleFileInfo | MultipleFilesInfo
};

export type SingleFileInfo = {
  len: number,
  name: string,
  piece_len: number,
  pieces: Uint8Array[],
};

export type MultipleFilesInfo = {
  files: FileLenAndPath[],
  dest_dir: string,
  piece_len: number,
  pieces: Uint8Array[]
};

export type FileLenAndPath = {
  len: number,
  path: string[]
};

export function read_bittorrent_file(filepath: string): [Bittorrent, Uint8Array] {
  const data = fs.readFileSync(filepath);
  const b = bc.bencode_decode_buff(data);
  u.throw_if_val_wrong_type(b instanceof Map);
  const info_hash = c.createHash("sha1")
    .update(extract_info(b as bc.BencodeDict))
    .digest();
  return [bencodeVal_to_bittorrent(b), info_hash];
}

function extract_info(d: bc.BencodeDict): string {
  u.throw_if_not_has(d, "info");
  return bc.bencode_encode(d.get("info")! as bc.BencodeDict);
}

export function bencodeVal_to_bittorrent(b: bc.BencodeVal): Bittorrent {
  let res: Bittorrent;
  u.throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  u.throw_if_not_has(d, "announce");
  u.throw_if_val_wrong_type(d.get("announce")! instanceof Uint8Array);
  u.throw_if_not_has(d, "info");
  const a = d.get("announce")! as Uint8Array;
  let i;
  if (is_single_file_torrent(b))
    i = bencodeVal_to_SingleFileInto(d.get("info")!);
  else
    i = bencodeVal_to_MultipleFilesInto(d.get("info")!);
  return {announce: new TextDecoder().decode(a), info: i};
}

export function bittorrent_to_bencodeVal(b: Bittorrent): bc.BencodeVal {
  let res: bc.BencodeDict = new Map();
  return res;
}

export function bencodeVal_to_SingleFileInto(b: bc.BencodeVal): SingleFileInfo {
  u.throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  u.throw_if_not_has(d, "piece length");
  u.throw_if_not_has(d, "pieces");
  u.throw_if_not_has(d, "length");
  u.throw_if_not_has(d, "name");
  const hashes_buff = d.get("pieces")! as Uint8Array;
  return {
    len: d.get("length")! as number,
    name: new TextDecoder().decode(d.get("name")! as Uint8Array),
    piece_len: d.get("piece length")! as number,
    pieces: split_into_20byte_chunks(hashes_buff),
  };
}

export function bencodeVal_to_MultipleFilesInto(b: bc.BencodeVal): MultipleFilesInfo {
  u.throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  u.throw_if_not_has(d, "files");
  u.throw_if_val_wrong_type(Array.isArray(d.get("files")));
  u.throw_if_not_has(d, "piece length");
  u.throw_if_not_has(d, "pieces");
  u.throw_if_not_has(d, "name");
  const hashes_buff = d.get("pieces")! as Uint8Array;
  const files = d.get("files")! as bc.BencodeDict[];
  return {
    files: torrent_extract_files(files),
    dest_dir: new TextDecoder().decode(d.get("name")! as Uint8Array),
    piece_len: d.get("piece length")! as number,
    pieces: split_into_20byte_chunks(hashes_buff),
  };
}

export function is_single_file_bittorrent(b: Bittorrent): boolean {
  return "files" in b.info;
}

function is_single_file_torrent(b: bc.BencodeVal): boolean {
  u.throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  u.throw_if_not_has(d, "info");
  u.throw_if_val_wrong_type(d.get("info")! instanceof Map);
  return !(d.get("info") as bc.BencodeDict).has("files");
}

function torrent_extract_files(files: bc.BencodeDict[]): FileLenAndPath[] {
  let res: FileLenAndPath[] = [];
  for (const d of files) {
    u.throw_if_not_has(d, "length");
    u.throw_if_not_has(d, "path");
    u.throw_if_val_wrong_type(typeof d.get("length")! === "number");
    u.throw_if_val_wrong_type(Array.isArray(d.get("path")!));
    let p: string[] = [];
    for (const e of d.get("path")! as bc.BencodeVal[]) {
      u.throw_if_val_wrong_type(e instanceof Uint8Array);
      p.push(new TextDecoder().decode(e as Uint8Array));
    }
    res.push({
      len: d.get("length")! as number,
      path: p
    });
  }
  return res;
}

function split_into_20byte_chunks(data: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += 20) {
    chunks.push(data.slice(i, i + 20));
  }
  return chunks;
}
