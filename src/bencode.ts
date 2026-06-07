type BencodeElem = BencodeStr | BencodeInt | BencodeDict | BencodeList;
type BencodeStr = string;
type BencodeInt = number;
type BencodeDict = Map<BencodeElem, BencodeElem>;
type BencodeList = BencodeElem[];

export function bencode_decode(bstr: string): BencodeElem {
  const [res, l] = bencode_decode_next_elem(bstr, 0);
  if (l !== bstr.length) {
    throw new Error("trailing data");
  }
  return res;
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

function bencode_decode_int(bstr: string, pos: number): [BencodeInt, number] {
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
  return [Number(ntxt), end+1]
}

function bencode_decode_str(bstr: string, pos: number): [BencodeStr, number] {
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
  return [str, mid+len+1];
}

function bencode_decode_dict(bstr: string, pos: number): [BencodeDict, number] {
  if (bstr.charAt(pos) !== "d") {
    throw new Error("no bencode dictionary found");
  }
  let res: BencodeDict = new Map();
  let p = pos+1;
  let k, v: BencodeElem;
  let prevk: BencodeElem = "";
  while (bstr.charAt(p) !== "e") {
    [k, p] = bencode_decode_next_elem(bstr, p);
    if (!isBencodeStr(k)) {
      throw new Error("map key is not a string");
    }
    if (res.has(k)) {
      throw new Error("duplicate key");
    }
    if (k < prevk) {
      throw new Error("keys not ordered");
    }
    prevk = k;
    [v, p] = bencode_decode_next_elem(bstr, p);
    res.set(k, v);
  }
  return [res, p+1];
}

function bencode_decode_list(bstr: string, pos: number): [BencodeList, number] {
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
  return [res, p+1];
}

function isBencodeStr(x: BencodeElem): boolean {
  return typeof x === "string";
}