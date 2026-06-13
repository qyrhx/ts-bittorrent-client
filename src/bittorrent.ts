import * as bc from "./bencode.js";
import fs from 'node:fs';

export type Bittorrent = {
  announce: string,
  info: BittorrentInfo
};

export type BittorrentInfo = {
  len: number,
  name: string,
  pieceLen: number,
  pieces: Uint8Array[],
};

export function read_bittorrent_file(filepath: string): Bittorrent {
  const data = fs.readFileSync(filepath);
  const b = bc.bencode_decode_buff(data);
  return bencode_elem_to_bittorrent(b);
}

export function bencode_elem_to_bittorrent(b: bc.BencodeVal): Bittorrent {
  let res: Bittorrent;
  throw_if_val_wrong_type(b instanceof Map);
  const d = b as bc.BencodeDict;
  throw_if_not_has(d, "announce");
  throw_if_val_wrong_type(d.get("announce")! instanceof Uint8Array);
  throw_if_not_has(d, "info");
  const a = d.get("announce")! as Uint8Array;
  const i = bencode_elem_to_bittorrentInfo(d.get("info")!);
  return {announce: new TextDecoder().decode(a), info: i};
}

export function bencode_elem_to_bittorrentInfo(b: bc.BencodeVal): BittorrentInfo {
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
    pieceLen: d.get("piece length")! as number,
    pieces: split_into_20byte_chunks(hashes_buff),
  };
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