import { describe, it } from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import {
  encode_handshake,
  decode_handshake,
  encode_message,
  decode_message,
  extract_frames,
  PeerMessage,
} from "./peer_wire.js";

const throws = (fn: () => unknown) => assert.throws(fn);

// -- Handshake

describe("handshake", () => {
  it("round-trips info_hash and peer_id", () => {
    const info_hash = Buffer.from("0102030405060708091011121314151617181920", "hex");
    const peer_id = Buffer.from("-TS0001-abcdefghijkl");
    const encoded = encode_handshake(info_hash, peer_id);
    const [decoded, consumed] = decode_handshake(encoded);
    assert.equal(consumed, 68);
    assert.deepEqual(new Uint8Array(decoded.info_hash), new Uint8Array(info_hash));
    assert.deepEqual(new Uint8Array(decoded.peer_id), new Uint8Array(peer_id));
    assert.deepEqual(new Uint8Array(decoded.reserved), new Uint8Array(8));
  });

  it("encodes exactly 68 bytes", () => {
    const info_hash = new Uint8Array(20).fill(1);
    const peer_id = new Uint8Array(20).fill(2);
    assert.equal(encode_handshake(info_hash, peer_id).length, 68);
  });

  it("preserves reserved bytes when provided", () => {
    const info_hash = new Uint8Array(20).fill(1);
    const peer_id = new Uint8Array(20).fill(2);
    const reserved = new Uint8Array(8);
    reserved[7] = 0x04; // fast extension bit, e.g.
    const [decoded] = decode_handshake(encode_handshake(info_hash, peer_id, reserved));
    assert.deepEqual(new Uint8Array(decoded.reserved), reserved);
  });

  it("reports bytes consumed even with trailing data", () => {
    const info_hash = new Uint8Array(20).fill(1);
    const peer_id = new Uint8Array(20).fill(2);
    const encoded = encode_handshake(info_hash, peer_id);
    const withExtra = new Uint8Array(encoded.length + 5);
    withExtra.set(encoded, 0);
    const [, consumed] = decode_handshake(withExtra);
    assert.equal(consumed, 68);
  });

  it("throws on wrong info_hash length", () => {
    throws(() => encode_handshake(new Uint8Array(19), new Uint8Array(20)));
  });

  it("throws on wrong peer_id length", () => {
    throws(() => encode_handshake(new Uint8Array(20), new Uint8Array(21)));
  });

  it("throws on truncated buffer", () => {
    throws(() => decode_handshake(new Uint8Array(67)));
  });

  it("throws on wrong pstrlen", () => {
    const buf = encode_handshake(new Uint8Array(20), new Uint8Array(20));
    buf[0] = 5;
    throws(() => decode_handshake(buf));
  });

  it("throws on wrong protocol string", () => {
    const buf = encode_handshake(new Uint8Array(20), new Uint8Array(20));
    buf.set(Buffer.from("Not the right proto!"), 1); // same length (19) as pstrlen, wrong text
    throws(() => decode_handshake(buf));
  });
});

// -- Message round-trips

describe("message round-trips", () => {
  const cases: PeerMessage[] = [
    { kind: "keep_alive" },
    { kind: "choke" },
    { kind: "unchoke" },
    { kind: "interested" },
    { kind: "not_interested" },
    { kind: "have", piece_index: 7 },
    { kind: "bitfield", bitfield: Uint8Array.of(0xff, 0x00, 0x80) },
    { kind: "request", index: 1, begin: 16384, length: 16384 },
    { kind: "piece", index: 1, begin: 0, block: Uint8Array.of(1, 2, 3, 4) },
    { kind: "cancel", index: 2, begin: 32768, length: 16384 },
  ];

  for (const msg of cases) {
    it(`round-trips ${msg.kind}`, () => {
      const encoded = encode_message(msg);
      // encoded includes the 4-byte length prefix; strip it the same
      // way extract_frames does before handing to decode_message.
      const decoded = decode_message(encoded.slice(4));
      assert.deepEqual(decoded, msg);
    });
  }

  it("keep_alive encodes as exactly 4 zero bytes", () => {
    assert.deepEqual(encode_message({ kind: "keep_alive" }), Uint8Array.of(0, 0, 0, 0));
  });

  it("choke/unchoke/interested/not_interested encode with zero-length payload", () => {
    const encoded = encode_message({ kind: "interested" });
    // 4-byte length (=1) + 1 id byte, nothing else
    assert.equal(encoded.length, 5);
    assert.deepEqual(encoded.slice(0, 4), Uint8Array.of(0, 0, 0, 1));
  });

  it("have message carries a 4-byte big-endian piece index", () => {
    const encoded = encode_message({ kind: "have", piece_index: 0x01020304 });
    assert.deepEqual(encoded, Uint8Array.of(0, 0, 0, 5, 4, 1, 2, 3, 4));
  });
});

// -- Message decode error cases

describe("message decode errors", () => {
  it("throws on unknown message id", () => {
    throws(() => decode_message(Uint8Array.of(99)));
  });

  it("throws on malformed have (wrong payload length)", () => {
    throws(() => decode_message(Uint8Array.of(4, 1, 2)));
  });

  it("throws on malformed request (wrong payload length)", () => {
    throws(() => decode_message(Uint8Array.of(6, 0, 0, 0, 1)));
  });

  it("throws on truncated piece message", () => {
    throws(() => decode_message(Uint8Array.of(7, 0, 0, 0)));
  });

  it("accepts an empty bitfield", () => {
    assert.deepEqual(decode_message(Uint8Array.of(5)), { kind: "bitfield", bitfield: new Uint8Array(0) });
  });
});

// -- Frame reassembly

describe("extract_frames", () => {
  it("extracts nothing from an empty buffer", () => {
    const { frames, rest } = extract_frames(new Uint8Array(0));
    assert.deepEqual(frames, []);
    assert.equal(rest.length, 0);
  });

  it("extracts a single complete frame", () => {
    const wire = encode_message({ kind: "unchoke" });
    const { frames, rest } = extract_frames(wire);
    assert.equal(frames.length, 1);
    assert.deepEqual(decode_message(frames[0]), { kind: "unchoke" });
    assert.equal(rest.length, 0);
  });

  it("extracts multiple frames delivered in one chunk", () => {
    const wire = concatAll([
      encode_message({ kind: "choke" }),
      encode_message({ kind: "have", piece_index: 3 }),
      encode_message({ kind: "unchoke" }),
    ]);
    const { frames, rest } = extract_frames(wire);
    assert.equal(frames.length, 3);
    assert.deepEqual(frames.map(decode_message), [
      { kind: "choke" },
      { kind: "have", piece_index: 3 },
      { kind: "unchoke" },
    ]);
    assert.equal(rest.length, 0);
  });

  it("leaves a partial trailing frame in `rest`", () => {
    const wire = concatAll([
      encode_message({ kind: "unchoke" }),
      encode_message({ kind: "have", piece_index: 9 }),
    ]);
    const cut = wire.slice(0, wire.length - 2); // chop off the last 2 bytes of the 2nd frame
    const { frames, rest } = extract_frames(cut);
    assert.equal(frames.length, 1);
    assert.deepEqual(decode_message(frames[0]), { kind: "unchoke" });
    assert.equal(rest.length, cut.length - encode_message({ kind: "unchoke" }).length);
  });

  it("handles a message split across two chunks, fed incrementally", () => {
    const wire = encode_message({ kind: "have", piece_index: 42 });
    const splitPoint = 3; // splits inside the 4-byte length prefix itself
    const chunk1 = wire.slice(0, splitPoint);
    const chunk2 = wire.slice(splitPoint);

    const first = extract_frames(chunk1);
    assert.equal(first.frames.length, 0);

    const combined = concatAll([first.rest, chunk2]);
    const second = extract_frames(combined);
    assert.equal(second.frames.length, 1);
    assert.deepEqual(decode_message(second.frames[0]), { kind: "have", piece_index: 42 });
    assert.equal(second.rest.length, 0);
  });

  it("handles a payload split partway through, fed incrementally", () => {
    const wire = encode_message({ kind: "piece", index: 0, begin: 0, block: Uint8Array.of(9, 8, 7, 6, 5) });
    const splitPoint = 7; // inside the payload, after id+index but before all of begin/block
    const chunk1 = wire.slice(0, splitPoint);
    const chunk2 = wire.slice(splitPoint);

    const first = extract_frames(chunk1);
    assert.equal(first.frames.length, 0);
    assert.equal(first.rest.length, splitPoint);

    const second = extract_frames(concatAll([first.rest, chunk2]));
    assert.equal(second.frames.length, 1);
    assert.deepEqual(decode_message(second.frames[0]), {
      kind: "piece",
      index: 0,
      begin: 0,
      block: Uint8Array.of(9, 8, 7, 6, 5),
    });
  });

  it("keeps working across many small incremental chunks (byte-at-a-time)", () => {
    const wire = concatAll([
      encode_message({ kind: "interested" }),
      encode_message({ kind: "bitfield", bitfield: Uint8Array.of(0xf0, 0x0f) }),
      encode_message({ kind: "request", index: 5, begin: 0, length: 16384 }),
    ]);

    let buffered: Uint8Array = new Uint8Array(0);
    const decoded: PeerMessage[] = [];
    for (let i = 0; i < wire.length; i++) {
      buffered = concatAll([buffered, wire.slice(i, i + 1)]);
      const { frames, rest } = extract_frames(buffered);
      for (const f of frames) decoded.push(decode_message(f));
      buffered = rest;
    }

    assert.deepEqual(decoded, [
      { kind: "interested" },
      { kind: "bitfield", bitfield: Uint8Array.of(0xf0, 0x0f) },
      { kind: "request", index: 5, begin: 0, length: 16384 },
    ]);
    assert.equal(buffered.length, 0);
  });

  it("handles a zero-length keep-alive mixed in with real messages", () => {
    const wire = concatAll([
      encode_message({ kind: "keep_alive" }),
      encode_message({ kind: "choke" }),
    ]);
    const { frames } = extract_frames(wire);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames.map(decode_message), [{ kind: "keep_alive" }, { kind: "choke" }]);
  });
});

function concatAll(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const res = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    res.set(part, p);
    p += part.length;
  }
  return res;
}
