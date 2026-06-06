type BencodeElem = BencodeStr | BencodeNum | BencodeDict | BencodeList;
type BencodeStr = string;
type BencodeNum = number;
type BencodeDict = Map<BencodeElem, BencodeElem>;
type BencodeList = BencodeElem[];

export function bencode_decode(bstr: string): BencodeElem {
  const [res, _] = bencode_decode_next_elem(bstr, 0);
  return res;
}

function bencode_decode_next_elem(bstr: string, pos: number): [BencodeElem, number] {
  if (bstr.charAt(pos) === "i") {
    return bencode_decode_num(bstr, pos);
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

function bencode_decode_num(bstr: string, pos: number): [BencodeNum, number] {
  if (bstr.charAt(pos) !== "i") {
    throw new Error("could not find number to decode");
  }
  const end = bstr.indexOf("e", pos);
  if (end === -1) {
    throw new Error("unterminated integer");
  }
  const ntxt = bstr.slice(pos + 1, end);
  if (!/^-?\d+$/.test(ntxt)) {
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
  return [str, mid+len+1];
}

function bencode_decode_dict(bstr: string, pos: number): [BencodeDict, number] {
  if (bstr.charAt(pos) !== "d") {
    throw new Error("no bencode dictionary found");
  }
  let res: BencodeDict = new Map();
  let p = pos+1;
  let k, v: BencodeElem;
  while (bstr.charAt(p) !== "e") {
    [k, p] = bencode_decode_next_elem(bstr, p);
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