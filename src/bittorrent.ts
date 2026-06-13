import * as bc from "./bencode.js";
import fs from 'node:fs';

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

export function read_bittorrent_file(filepath: string): Bittorrent {
  const data = fs.readFileSync(filepath);
  const b = bc.bencode_decode_buff(data);
  return bencodeVal_to_bittorrent(b);
}

export function bencodeVal_to_bittorrent(b: bc.BencodeVal): Bittorrent {
  let res: Bittorrent;
  throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  throw_if_not_has(d, "announce");
  throw_if_val_wrong_type(d.get("announce")! instanceof Uint8Array);
  throw_if_not_has(d, "info");
  const a = d.get("announce")! as Uint8Array;
  let i;
  if (is_single_file_torrent(b)) {
    i = bencodeVal_to_SingleFileInto(d.get("info")!);
  }
  else
    i = bencodeVal_to_MultipleFilesInto(d.get("info")!);
  return {announce: new TextDecoder().decode(a), info: i};
}

export function bencodeVal_to_SingleFileInto(b: bc.BencodeVal): SingleFileInfo {
  throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  throw_if_not_has(d, "piece length");
  throw_if_not_has(d, "pieces");
  throw_if_not_has(d, "length");
  throw_if_not_has(d, "name");
  const hashes_buff = d.get("pieces")! as Uint8Array;
  return {
    len: d.get("length")! as number,
    name: new TextDecoder().decode(d.get("name")! as Uint8Array),
    piece_len: d.get("piece length")! as number,
    pieces: split_into_20byte_chunks(hashes_buff),
  };
}

export function bencodeVal_to_MultipleFilesInto(b: bc.BencodeVal): MultipleFilesInfo {
  throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  throw_if_not_has(d, "files");
  throw_if_val_wrong_type(Array.isArray(d.get("files")));
  throw_if_not_has(d, "piece length");
  throw_if_not_has(d, "pieces");
  throw_if_not_has(d, "name");
  const hashes_buff = d.get("pieces")! as Uint8Array;
  const files = d.get("files")! as bc.BencodeDict[];
  return {
    files: torrent_extract_files(files),
    dest_dir: new TextDecoder().decode(d.get("name")! as Uint8Array),
    piece_len: d.get("piece length")! as number,
    pieces: split_into_20byte_chunks(hashes_buff),
  };
}

function torrent_extract_files(files: bc.BencodeDict[]): FileLenAndPath[] {
  let res: FileLenAndPath[] = [];
  for (const d of files) {
    throw_if_not_has(d, "length");
    throw_if_not_has(d, "path");
    throw_if_val_wrong_type(typeof d.get("length")! === "number");
    throw_if_val_wrong_type(Array.isArray(d.get("path")!));
    let p: string[] = [];
    for (const e of d.get("path")! as bc.BencodeVal[]) {
      throw_if_val_wrong_type(e instanceof Uint8Array);
      p.push(new TextDecoder().decode(e as Uint8Array));
    }
    res.push({
      len: d.get("length")! as number,
      path: p
    });
  }
  return res;
}

function throw_if_not_has(d: Map<string, unknown>, k: string): void {
  if (!d.has(k))
    throw Error(`'${k}' does not exist in dictionary ${d}`);
}

function throw_if_val_wrong_type(pred: boolean): void {
  if (!pred)
    throw Error(`Type error.`);
}

function split_into_20byte_chunks(data: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += 20) {
    chunks.push(data.slice(i, i + 20));
  }
  return chunks;
}

function is_single_file_torrent(b: bc.BencodeVal): boolean {
  throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  throw_if_not_has(d, "info");
  throw_if_val_wrong_type(d.get("info")! instanceof Map);
  return !(d.get("info") as bc.BencodeDict).has("files");
}