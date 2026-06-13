import { Buffer } from "node:buffer";

export type BencodeVal = Uint8Array | number | BencodeDict | BencodeVal[];
export type BencodeDict = Map<string, BencodeVal>;

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
    return `${b.length}:${b}`;
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
  else /*if (!Number.isNaN(b.at(pos)))*/ {
    return bencode_decode_str(b, pos);
  }
  // else {
  //   throw new Error("invalid bencode string");
  // }
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
  if (!/^(0|(-?[1-9]\d*))$/.test(ntxt.toString())) {
    throw new Error("invalid bencode number");
  }
  return [Number(ntxt), end+1]
}

function bencode_decode_str(b: Uint8Array, pos: number): [BencodeVal, number] {
  const mid = b.indexOf(":".codePointAt(0)!, pos);
  if (mid === -1) {
    throw new Error("can't find ':' separator");
  }
  const lenstr: string = b.slice(pos, mid).toString();
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
    const kstr = k.toString();
    if (res.has(kstr)) {
      throw new Error("duplicate key");
    }

    if (k < prevk) {
      throw new Error("keys not ordered");
    }
    prevk = k;
    [v, p] = bencode_decode_next_elem(b, p);
    res.set(kstr, v);
  }
  return [res, p+1];
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