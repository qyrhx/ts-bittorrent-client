import { Buffer } from "node:buffer";
import fs from "node:fs";

export type BencodeVal = Uint8Array | number | BencodeDict | BencodeVal[];
export type BencodeDict = Map<string, BencodeVal>;

// Uint8Array.prototype.toString() (unlike Buffer's) is inherited from
// TypedArray/Array and joins bytes as comma-separated decimals, not text.
// Always route through Buffer.from(...) so decoding works the same whether
// callers pass a real Buffer or a plain Uint8Array.
function bytesToString(b: Uint8Array): string {
  return Buffer.from(b).toString();
}

export function bencode_read_file(filepath: string): BencodeVal {
  const data = fs.readFileSync(filepath);
  return bencode_decode_buff(data);
}

export function bencode_decode_buff(b: Uint8Array): BencodeVal {
  const [res, l] = bencode_decode_next_elem(b, 0);
  if (l !== b.length) {
    throw new Error("trailing data");
  }
  return res;
}

export function bencode_decode(bstr: string): BencodeVal {
  const [res, l] = bencode_decode_next_elem(Buffer.from(bstr), 0);
  if (l !== bstr.length) {
    throw new Error("trailing data");
  }
  return res;
}

export function bencode_encode(b: BencodeVal): string {
  if (typeof b === "number")
    return `i${b}e`;
  if (b instanceof Uint8Array)
    return `${b.length}:${bytesToString(b)}`;
  if (Array.isArray(b))
    return `l${b.map(bencode_encode).join("")}e`;
  else {
    let encode_kv = ([k, v]: [string, BencodeVal]) =>
      `${bencode_encode(Buffer.from(k))}${bencode_encode(v)}`;
    let res = Array.from(b, encode_kv).join("");
    return `d${res}e`;
  }
}

function bencode_decode_next_elem(b: Uint8Array, pos: number): [BencodeVal, number] {
  if (b.at(pos) === "i".codePointAt(0)) {
    return bencode_decode_int(b, pos);
  }
  else if (b.at(pos) === "d".codePointAt(0)) {
    return bencode_decode_dict(b, pos);
  }
  else if (b.at(pos) === "l".codePointAt(0)) {
    return bencode_decode_list(b, pos);
  }
  else {
    return bencode_decode_str(b, pos);
  }
}

function bencode_decode_int(b: Uint8Array, pos: number): [BencodeVal, number] {
  if (b.at(pos) !== "i".codePointAt(0)) {
    throw new Error("could not find number to decode");
  }
  const end = b.indexOf("e".codePointAt(0)!, pos);
  if (end === -1) {
    throw new Error("unterminated integer");
  }
  const ntxt = b.slice(pos + 1, end);
  const ntxtStr = bytesToString(ntxt);
  if (!/^(0|(-?[1-9]\d*))$/.test(ntxtStr)) {
    throw new Error("invalid bencode number");
  }
  return [Number(ntxtStr), end+1]
}

function bencode_decode_str(b: Uint8Array, pos: number): [BencodeVal, number] {
  const mid = b.indexOf(":".codePointAt(0)!, pos);
  if (mid === -1) {
    throw new Error("can't find ':' separator");
  }
  const lenstr: string = bytesToString(b.slice(pos, mid));
  if (!/^\d+$/.test(lenstr)) {
    throw new Error("invalid length for string");
  }
  const len = Number(lenstr);
  const str = b.slice(mid+1, mid+len+1);
  if (str.length !== len) {
    throw new Error("Unexpected EOF");
  }
  return [str, mid+len+1];
}

// Uint8Array comparison with `<`/`>` coerces via toString() (the same
// comma-joined-decimal trap as bytesToString above was fixing), which does
// NOT produce correct lexicographic byte ordering. Compare bytes directly.
function compare_bytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function bencode_decode_dict(b: Uint8Array, pos: number): [BencodeVal, number] {
  if (b.at(pos) !== "d".codePointAt(0)) {
    throw new Error("no bencode dictionary found");
  }
  let res: BencodeDict = new Map();
  let p = pos+1;
  let k, v: BencodeVal;
  let prevk: Uint8Array = new Uint8Array();
  while (b.at(p) !== "e".codePointAt(0)) {
    [k, p] = bencode_decode_next_elem(b, p);
    if (!(k instanceof Uint8Array)) {
      throw new Error("map key is not a string");
    }
    const kstr = bytesToString(k);
    if (res.has(kstr)) {
      throw new Error("duplicate key");
    }

    if (compare_bytes(k, prevk) < 0) {
      throw new Error("keys not ordered");
    }
    prevk = k;
    const prevp = p;
    [v, p] = bencode_decode_next_elem(b, p);
    res.set(kstr, v);
  }
  return [res, p+1];
}

/**
 * Scan a top-level bencoded dictionary and return the raw encoded bytes
 * of the value stored under `key`, without re-encoding anything.
 *
 * This exists because the BitTorrent info-hash must be computed over the
 * *original* bytes of the "info" dict exactly as they appeared in the
 * .torrent file. Decoding into a Map and re-encoding it can only
 * reproduce those bytes if the encoder is byte-identical to whatever
 * produced the file (key order, integer formatting, etc.) — hashing the
 * original slice sidesteps that assumption entirely.
 *
 * Throws if `b` is not a dict at `pos`, or if `key` is not present.
 */
export function bencode_extract_raw_value(b: Uint8Array, pos: number, key: string): Uint8Array {
  if (b.at(pos) !== "d".codePointAt(0)) {
    throw new Error("no bencode dictionary found");
  }
  let p = pos + 1;
  let k: BencodeVal, v: BencodeVal;
  while (b.at(p) !== "e".codePointAt(0)) {
    [k, p] = bencode_decode_next_elem(b, p);
    if (!(k instanceof Uint8Array)) {
      throw new Error("map key is not a string");
    }
    const kstr = bytesToString(k);
    const start = p;
    [v, p] = bencode_decode_next_elem(b, p);
    if (kstr === key) {
      return b.slice(start, p);
    }
  }
  throw new Error(`key '${key}' not found in dictionary`);
}

function bencode_decode_list(b: Uint8Array, pos: number): [BencodeVal, number] {
  if (b.at(pos) !== "l".codePointAt(0)) {
    throw new Error("no bencode list found");
  }
  let res: BencodeVal[] = [];
  let p = pos+1;
  let elem: BencodeVal;
  while (b.at(p) !== "e".codePointAt(0)) {
    [elem, p] = bencode_decode_next_elem(b, p);
    res.push(elem);
  }
  return [res, p+1];
}
