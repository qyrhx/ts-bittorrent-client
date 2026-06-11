export type BencodeElem = {
  type: BencodeType,
  val: BencodeVal
};
export enum BencodeType { BStr, BInt, BDict, BList };
type BencodeVal = BencodeStr | BencodeInt | BencodeDict | BencodeList;
type BencodeStr = string;
type BencodeInt = number;
type BencodeDict = Map<string, BencodeElem>;
type BencodeList = BencodeElem[];

export function bencode_decode(bstr: string): BencodeElem {
  const [res, l] = bencode_decode_next_elem(bstr, 0);
  if (l !== bstr.length) {
    throw new Error("trailing data");
  }
  return res;
}

export function bencode_encode(b: BencodeElem): string {
  switch (b.type) {
    case BencodeType.BInt: return `i${b.val}e`;
    case BencodeType.BStr: return `${(b.val as BencodeStr).length}:${b.val}`;
    case BencodeType.BList: return `l${(b.val as BencodeList).map(bencode_encode).join("")}e`;
    case BencodeType.BDict:
      let encode_kv = ([k, v]: [string, BencodeElem]) => {
        const enck = bencode_encode({type: BencodeType.BStr, val: k});
        return `${enck}${bencode_encode(v)}`;
      }
      let res = Array.from(b.val as BencodeDict, encode_kv).join("");
      return `d${res}e`;
  }
}

function bencode_decode_next_elem(bstr: string, pos: number): [BencodeElem, number] {
  if (bstr.charAt(pos) === "i") {
    return bencode_decode_int(bstr, pos);
  }
  else if (bstr.charAt(pos) === "d") {
    return bencode_decode_dict(bstr, pos);
  }
  else if (bstr.charAt(pos) === "l") {
    return bencode_decode_list(bstr, pos);
  }
  else if (!Number.isNaN(bstr.charAt(pos))) {
    return bencode_decode_str(bstr, pos);
  }
  else {
    throw new Error("invalid bencode string");
  }
}

function bencode_decode_int(bstr: string, pos: number): [BencodeElem, number] {
  if (bstr.charAt(pos) !== "i") {
    throw new Error("could not find number to decode");
  }
  const end = bstr.indexOf("e", pos);
  if (end === -1) {
    throw new Error("unterminated integer");
  }
  const ntxt = bstr.slice(pos + 1, end);
  if (!/^(0|(-?[1-9]\d*))$/.test(ntxt)) {
    throw new Error("invalid bencode number");
  }
  const e = {type: BencodeType.BInt, val: Number(ntxt)};
  return [e, end+1]
}

function bencode_decode_str(bstr: string, pos: number): [BencodeElem, number] {
  const mid = bstr.indexOf(":", pos);
  if (mid === -1) {
    throw new Error("can't find ':' separator");
  }
  const text = bstr.slice(pos, mid);
  if (!/^\d+$/.test(text)) {
    throw new Error("invalid length for string");
  }
  const len = Number(text);
  const str = bstr.slice(mid+1, mid+len+1);
  if (str.length !== len) {
    throw new Error("Unexpected EOF");
  }
  const e = {type: BencodeType.BStr, val: str};
  return [e, mid+len+1];
}

function bencode_decode_dict(bstr: string, pos: number): [BencodeElem, number] {
  if (bstr.charAt(pos) !== "d") {
    throw new Error("no bencode dictionary found");
  }
  let res: BencodeDict = new Map();
  let p = pos+1;
  let k, v: BencodeElem;
  let prevk: BencodeVal = "";
  while (bstr.charAt(p) !== "e") {
    [k, p] = bencode_decode_next_elem(bstr, p);
    if (k.type !== BencodeType.BStr) {
      throw new Error("map key is not a string");
    }
    if (res.has(k.val as string)) {
      throw new Error("duplicate key");
    }

    if (k.val < prevk) {
      throw new Error("keys not ordered");
    }
    prevk = k.val;
    [v, p] = bencode_decode_next_elem(bstr, p);
    res.set(k.val as string, v);
  }
  const e = {type: BencodeType.BDict, val: res};
  return [e, p+1];
}

function bencode_decode_list(bstr: string, pos: number): [BencodeElem, number] {
  if (bstr.charAt(pos) !== "l") {
    throw new Error("no bencode list found");
  }
  let res: BencodeList = [];
  let p = pos+1;
  let elem: BencodeElem;
  while (bstr.charAt(p) !== "e") {
    [elem, p] = bencode_decode_next_elem(bstr, p);
    res.push(elem);
  }
  const e = {type: BencodeType.BList, val: res};
  return [e, p+1];
}