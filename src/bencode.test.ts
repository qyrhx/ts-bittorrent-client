import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bencode_decode } from "./bencode.ts";

const throws = (fn: () => unknown) => assert.throws(fn);

// Integers

describe("integers", () => {
  it("decodes zero", () => {
    assert.equal(bencode_decode("i0e"), 0);
  });

  it("decodes positive integer", () => {
    assert.equal(bencode_decode("i42e"), 42);
  });

  it("decodes negative integer", () => {
    assert.equal(bencode_decode("i-42e"), -42);
  });

  it("decodes large integer", () => {
    assert.equal(bencode_decode("i1000000e"), 1_000_000);
  });

  it("decodes single digit 1", () => {
    assert.equal(bencode_decode("i1e"), 1);
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
    assert.equal(bencode_decode("0:"), "");
  });

  it("decodes simple ASCII string", () => {
    assert.equal(bencode_decode("7:bencode"), "bencode");
  });

  it("decodes single character", () => {
    assert.equal(bencode_decode("1:x"), "x");
  });

  it("decodes string containing spaces", () => {
    assert.equal(bencode_decode("5:hello"), "hello");
  });

  it("decodes string containing colons", () => {
    // "a:b" is 3 bytes
    assert.equal(bencode_decode("3:a:b"), "a:b");
  });

  it("decodes string containing 'e' (not confused with terminator)", () => {
    assert.equal(bencode_decode("1:e"), "e");
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
    assert.deepEqual(bencode_decode("l7:bencodee"), ["bencode"]);
  });

  it("decodes list of string and negative integer", () => {
    assert.deepEqual(bencode_decode("l7:bencodei-20ee"), ["bencode", -20]);
  });

  it("decodes list of integers", () => {
    assert.deepEqual(bencode_decode("li1ei2ei3ee"), [1, 2, 3]);
  });

  it("decodes nested list", () => {
    assert.deepEqual(bencode_decode("ll1:aee"), [["a"]]);
  });

  it("decodes list containing a dict", () => {
    assert.deepEqual(bencode_decode("ld1:ki1eee"), [new Map([["k", 1]])]);
  });

  it("decodes heterogeneous list", () => {
    assert.deepEqual(bencode_decode("li42e3:foolee"), [42, "foo", []]);
  });

  // Error cases
  it("throws on missing 'e' terminator", () => {
    throws(() => bencode_decode("li1e"));
  });
});

// Dictionaries

describe("dictionaries", () => {
  it("decodes empty dict", () => {
    assert.deepEqual(bencode_decode("de"), new Map());
  });

  it("decodes single key-value pair (string → integer)", () => {
    assert.deepEqual(bencode_decode("d3:fooi42ee"), new Map([["foo", 42]]));
  });

  it("decodes example from spec (meaning→42, wiki→bencode)", () => {
    // Keys in lexicographic order: "meaning" < "wiki"
    assert.deepEqual(
      bencode_decode("d7:meaningi42e4:wiki7:bencodee"),
      new Map([
        ["meaning", 42],
        ["wiki", "bencode"],
      ])
    );
  });

  it("decodes dict with list value", () => {
    assert.deepEqual(
      bencode_decode("d4:listli1ei2eee"),
      new Map([["list", [1, 2]]])
    );
  });

  it("decodes nested dict", () => {
    assert.deepEqual(
      bencode_decode("d5:outerd5:inneri1eee"),
      new Map([["outer", new Map([["inner", 1]])]])
    );
  });

  it("decodes dict with empty-string key", () => {
    assert.deepEqual(bencode_decode("d0:i0ee"), new Map([["", 0]]));
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
    // "zoo" before "ant" is wrong order
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
      new Map([
        ["length", 1024],
        ["name", "test.txt"],
      ])
    );
  });

  it("decodes list of dicts", () => {
    assert.deepEqual(bencode_decode("ld1:ai1eed1:bi2eee"), [
      new Map([["a", 1]]),
      new Map([["b", 2]]),
    ]);
  });

  it("decodes deeply nested structure", () => {
    // l l l i42e e e e  →  [[[42]]]
    assert.deepEqual(bencode_decode("llli42eeee"), [[[42]]]);
  });
});