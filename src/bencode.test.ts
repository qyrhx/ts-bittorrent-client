import { describe, it } from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { bencode_encode, bencode_decode, BencodeVal } from "./bencode.js";

const throws = (fn: () => unknown) => assert.throws(fn);

// -- Decoder

// Integers

describe("integers", () => {
  it("decodes zero", () => {
    assert.deepEqual(bencode_decode("i0e"), 0);
  });

  it("decodes positive integer", () => {
    assert.deepEqual(bencode_decode("i42e"), 42);
  });

  it("decodes negative integer", () => {
    assert.deepEqual(bencode_decode("i-42e"), -42);
  });

  it("decodes large integer", () => {
    assert.deepEqual(bencode_decode("i1000000e"), 1_000_000);
  });

  it("decodes single digit 1", () => {
    assert.deepEqual(bencode_decode("i1e"), 1);
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
    assert.deepEqual(bencode_decode("0:"), Buffer.from(""));
  });

  it("decodes simple ASCII string", () => {
    assert.deepEqual(bencode_decode("7:bencode"), Buffer.from("bencode"));
  });

  it("decodes single character", () => {
    assert.deepEqual(bencode_decode("1:x"), Buffer.from("x"));
  });

  it("decodes string containing spaces", () => {
    assert.deepEqual(bencode_decode("5:hello"), Buffer.from("hello"));
  });

  it("decodes string containing colons", () => {
    assert.deepEqual(bencode_decode("3:a:b"), Buffer.from("a:b"));
  });

  it("decodes string containing 'e' (not confused with terminator)", () => {
    assert.deepEqual(bencode_decode("1:e"), Buffer.from("e"));
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
    assert.deepEqual(bencode_decode("le"), []);
  });

  it("decodes list of one string", () => {
    assert.deepEqual(bencode_decode("l7:bencodee"), [Buffer.from("bencode")]);
  });

  it("decodes list of string and negative integer", () => {
    assert.deepEqual(bencode_decode("l7:bencodei-20ee"), [Buffer.from("bencode"), -20]);
  });

  it("decodes list of integers", () => {
    assert.deepEqual(bencode_decode("li1ei2ei3ee"), [1, 2, 3]);
  });

  it("decodes nested list", () => {
    assert.deepEqual(bencode_decode("ll1:aee"), [[Buffer.from("a")]]);
  });

  it("decodes list containing a dict", () => {
    assert.deepEqual(
      bencode_decode("ld1:ki1eee"),
      [new Map<string, BencodeVal>([["k", 1]])]
    );
  });

  it("decodes heterogeneous list", () => {
    assert.deepEqual(
      bencode_decode("li42e3:foolee"),
      [42, Buffer.from("foo"), []]
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
    assert.deepEqual(bencode_decode("de"), new Map([]));
  });

  it("decodes single key-value pair (string → integer)", () => {
    assert.deepEqual(
      bencode_decode("d3:fooi42ee"),
      new Map<string, BencodeVal>([["foo", 42]])
    );
  });

  it("decodes basic example (meaning→42, wiki→bencode)", () => {
    assert.deepEqual(
      bencode_decode("d7:meaningi42e4:wiki7:bencodee"),
      new Map<string, BencodeVal>([
        ["meaning", 42],
        ["wiki", Buffer.from("bencode")],
      ])
    );
  });

  it("decodes dict with list value", () => {
    assert.deepEqual(
      bencode_decode("d4:listli1ei2eee"),
      new Map<string, BencodeVal>([["list", [1, 2]]])
    );
  });

  it("decodes nested dict", () => {
    assert.deepEqual(
      bencode_decode("d5:outerd5:inneri1eee"),
      new Map<string, BencodeVal>(
        [["outer", new Map<string, BencodeVal>([["inner", 1]])]]
      )
    );
  });

  it("decodes dict with empty-string key", () => {
    assert.deepEqual(bencode_decode("d0:i0ee"), new Map<string, BencodeVal>([["", 0]]));
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
      new Map<string, BencodeVal>(
        [["length", 1024],
         ["name", Buffer.from("test.txt")]
        ]
      ));
  });

  it("decodes list of dicts", () => {
    assert.deepEqual(
      bencode_decode("ld1:ai1eed1:bi2eee"),
      [new Map<string, BencodeVal>([["a", 1]]),
       new Map<string, BencodeVal>([["b", 2]])
      ]
    );
  });

  it("decodes deeply nested structure", () => {
    assert.deepEqual(bencode_decode("llli42eeee"), [[[42]]]);
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