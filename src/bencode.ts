type BencodeElem = BencodeStr | BencodeNum | BencodeDict | BencodeList;
type BencodeStr = string;
type BencodeNum = number;
type BencodeDict = Map<BencodeElem, BencodeElem>;
type BencodeList = BencodeElem[];

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