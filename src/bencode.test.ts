import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bencode_encode, bencode_decode, BencodeType } from "./bencode.js";

const throws = (fn: () => unknown) => assert.throws(fn);

// helpers
const bint = (val: number) => ({ type: BencodeType.BInt, val });
const bstr = (val: string) => ({ type: BencodeType.BStr, val });
const blist = (val: unknown[]) => ({ type: BencodeType.BList, val });
const bdict = (entries: [unknown, unknown][]) => ({ type: BencodeType.BDict, val: new Map(entries) });

// -- Decoder

// Integers

describe("integers", () => {
  it("decodes zero", () => {
    assert.deepEqual(bencode_decode("i0e"), bint(0));
  });

  it("decodes positive integer", () => {
    assert.deepEqual(bencode_decode("i42e"), bint(42));
  });

  it("decodes negative integer", () => {
    assert.deepEqual(bencode_decode("i-42e"), bint(-42));
  });

  it("decodes large integer", () => {
    assert.deepEqual(bencode_decode("i1000000e"), bint(1_000_000));
  });

  it("decodes single digit 1", () => {
    assert.deepEqual(bencode_decode("i1e"), bint(1));
  });

  // Error cases
  it("throws on negative zero", () => {
    throws(() => bencode_decode("i-0e"));
  });

  it("throws on leading zero (i01e)", () => {
    throws(() => bencode_decode("i01e"));
  });

  it("throws on leading zero with negative (i-01e)", () => {
    throws(() => bencode_decode("i-01e"));
  });

  it("throws on non-digit characters inside integer", () => {
    throws(() => bencode_decode("i4x2e"));
  });

  it("throws on missing 'e' terminator", () => {
    throws(() => bencode_decode("i42"));
  });

  it("throws on empty integer body (ie)", () => {
    throws(() => bencode_decode("ie"));
  });
});

// Byte Strings

describe("byte strings", () => {
  it("decodes empty string", () => {
    assert.deepEqual(bencode_decode("0:"), bstr(""));
  });

  it("decodes simple ASCII string", () => {
    assert.deepEqual(bencode_decode("7:bencode"), bstr("bencode"));
  });

  it("decodes single character", () => {
    assert.deepEqual(bencode_decode("1:x"), bstr("x"));
  });

  it("decodes string containing spaces", () => {
    assert.deepEqual(bencode_decode("5:hello"), bstr("hello"));
  });

  it("decodes string containing colons", () => {
    assert.deepEqual(bencode_decode("3:a:b"), bstr("a:b"));
  });

  it("decodes string containing 'e' (not confused with terminator)", () => {
    assert.deepEqual(bencode_decode("1:e"), bstr("e"));
  });

  // Error cases
  it("throws on negative length", () => {
    throws(() => bencode_decode("-1:x"));
  });

  it("throws when colon is missing", () => {
    throws(() => bencode_decode("3abc"));
  });

  it("throws on unexpected EOF (length > available bytes)", () => {
    throws(() => bencode_decode("10:hi"));
  });
});

// Lists

describe("lists", () => {
  it("decodes empty list", () => {
    assert.deepEqual(bencode_decode("le"), blist([]));
  });

  it("decodes list of one string", () => {
    assert.deepEqual(bencode_decode("l7:bencodee"), blist([bstr("bencode")]));
  });

  it("decodes list of string and negative integer", () => {
    assert.deepEqual(bencode_decode("l7:bencodei-20ee"), blist([bstr("bencode"), bint(-20)]));
  });

  it("decodes list of integers", () => {
    assert.deepEqual(bencode_decode("li1ei2ei3ee"), blist([bint(1), bint(2), bint(3)]));
  });

  it("decodes nested list", () => {
    assert.deepEqual(bencode_decode("ll1:aee"), blist([blist([bstr("a")])]));
  });

  it("decodes list containing a dict", () => {
    assert.deepEqual(
      bencode_decode("ld1:ki1eee"),
      blist([bdict([["k", bint(1)]])])
    );
  });

  it("decodes heterogeneous list", () => {
    assert.deepEqual(
      bencode_decode("li42e3:foolee"),
      blist([bint(42), bstr("foo"), blist([])])
    );
  });

  // Error cases
  it("throws on missing 'e' terminator", () => {
    throws(() => bencode_decode("li1e"));
  });
});

// Dictionaries

describe("dictionaries", () => {
  it("decodes empty dict", () => {
    assert.deepEqual(bencode_decode("de"), bdict([]));
  });

  it("decodes single key-value pair (string → integer)", () => {
    assert.deepEqual(
      bencode_decode("d3:fooi42ee"),
      bdict([["foo", bint(42)]])
    );
  });

  it("decodes basic example (meaning→42, wiki→bencode)", () => {
    assert.deepEqual(
      bencode_decode("d7:meaningi42e4:wiki7:bencodee"),
      bdict([
        ["meaning", bint(42)],
        ["wiki", bstr("bencode")],
      ])
    );
  });

  it("decodes dict with list value", () => {
    assert.deepEqual(
      bencode_decode("d4:listli1ei2eee"),
      bdict([["list", blist([bint(1), bint(2)])]])
    );
  });

  it("decodes nested dict", () => {
    assert.deepEqual(
      bencode_decode("d5:outerd5:inneri1eee"),
      bdict([["outer", bdict([["inner", bint(1)]])]])
    );
  });

  it("decodes dict with empty-string key", () => {
    assert.deepEqual(bencode_decode("d0:i0ee"), bdict([["", bint(0)]]));
  });

  // Error cases
  it("throws on missing 'e' terminator", () => {
    throws(() => bencode_decode("d3:fooi1e"));
  });

  it("throws when dict key is not a string (integer key)", () => {
    throws(() => bencode_decode("di1ei2ee"));
  });

  it("throws on duplicate keys", () => {
    throws(() => bencode_decode("d3:fooi1e3:fooi2ee"));
  });

  it("throws when keys are not sorted lexicographically", () => {
    throws(() => bencode_decode("d3:zooi1e3:anti2ee"));
  });

  it("throws on missing value for a key", () => {
    throws(() => bencode_decode("d3:fooe"));
  });
});

// Root-level errors

describe("root-level errors", () => {
  it("throws on empty input (null root)", () => {
    throws(() => bencode_decode(""));
  });

  it("throws on invalid leading character", () => {
    throws(() => bencode_decode("x42"));
  });

  it("throws on non-singular root (trailing data)", () => {
    throws(() => bencode_decode("i1ei2e"));
  });
});

// Complex / integration

describe("complex structures", () => {
  it("decodes a torrent-like info dict", () => {
    assert.deepEqual(
      bencode_decode("d6:lengthi1024e4:name8:test.txte"),
      bdict([
        ["length", bint(1024)],
        ["name", bstr("test.txt")],
      ])
    );
  });

  it("decodes list of dicts", () => {
    assert.deepEqual(
      bencode_decode("ld1:ai1eed1:bi2eee"),
      blist([
        bdict([["a", bint(1)]]),
        bdict([["b", bint(2)]]),
      ])
    );
  });

  it("decodes deeply nested structure", () => {
    assert.deepEqual(
      bencode_decode("llli42eeee"),
      blist([blist([blist([bint(42)])])])
    );
  });
});

// -- Encoder: round-trips

const roundtrip = (s: string) =>
  assert.equal(bencode_encode(bencode_decode(s)), s);

describe("encode", () => {
  it("round-trips zero", () => roundtrip("i0e"));
  it("round-trips positive integer", () => roundtrip("i42e"));
  it("round-trips negative integer", () => roundtrip("i-42e"));
  it("round-trips empty string", () => roundtrip("0:"));
  it("round-trips simple string", () => roundtrip("7:bencode"));
  it("round-trips string containing colon", () => roundtrip("3:a:b"));
  it("round-trips empty list", () => roundtrip("le"));
  it("round-trips list of mixed types", () => roundtrip("l7:bencodei-20ee"));
  it("round-trips nested list", () => roundtrip("ll1:aee"));
  it("round-trips empty dict", () => roundtrip("de"));
  it("round-trips dict from spec", () => roundtrip("d7:meaningi42e4:wiki7:bencodee"));
  it("round-trips nested dict", () => roundtrip("d5:outerd5:inneri1eee"));
  it("round-trips torrent-like dict", () => roundtrip("d6:lengthi1024e4:name8:test.txte"));
  it("round-trips deeply nested structure", () => roundtrip("llli42eeee"));
});