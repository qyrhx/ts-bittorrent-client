// Pure encode/decode logic for the BitTorrent peer wire protocol (BEP 3).
// No sockets here — this module only turns bytes into typed messages and
// back, and reassembles length-prefixed frames out of accumulated stream
// bytes. Networking (src/peer_conn.ts) builds on top of this the same way
// src/bittorrent.ts builds on the pure src/bencode.ts.

const PSTR = "BitTorrent protocol";
const HANDSHAKE_LEN = 49 + PSTR.length; // 68

export const MessageId = {
  choke: 0,
  unchoke: 1,
  interested: 2,
  not_interested: 3,
  have: 4,
  bitfield: 5,
  request: 6,
  piece: 7,
  cancel: 8,
} as const;

export type PeerMessage =
  | { kind: "keep_alive" }
  | { kind: "choke" }
  | { kind: "unchoke" }
  | { kind: "interested" }
  | { kind: "not_interested" }
  | { kind: "have"; piece_index: number }
  | { kind: "bitfield"; bitfield: Uint8Array }
  | { kind: "request"; index: number; begin: number; length: number }
  | { kind: "piece"; index: number; begin: number; block: Uint8Array }
  | { kind: "cancel"; index: number; begin: number; length: number };

export type Handshake = {
  reserved: Uint8Array; // 8 bytes
  info_hash: Uint8Array; // 20 bytes
  peer_id: Uint8Array; // 20 bytes
};

// -- Handshake

export function encode_handshake(info_hash: Uint8Array, peer_id: Uint8Array, reserved?: Uint8Array): Uint8Array {
  if (info_hash.length !== 20) {
    throw new Error(`info_hash must be 20 bytes, got ${info_hash.length}`);
  }
  if (peer_id.length !== 20) {
    throw new Error(`peer_id must be 20 bytes, got ${peer_id.length}`);
  }
  const res = new Uint8Array(HANDSHAKE_LEN);
  let p = 0;
  res[p++] = PSTR.length;
  res.set(Buffer.from(PSTR, "ascii"), p);
  p += PSTR.length;
  res.set(reserved ?? new Uint8Array(8), p);
  p += 8;
  res.set(info_hash, p);
  p += 20;
  res.set(peer_id, p);
  return res;
}

// Decodes a handshake from the start of `buf`. Returns the parsed
// handshake and the number of bytes consumed (always HANDSHAKE_LEN),
// so callers reading from a stream know what's left over. Throws if
// `buf` is too short or doesn't start with the expected protocol string.
export function decode_handshake(buf: Uint8Array): [Handshake, number] {
  if (buf.length < HANDSHAKE_LEN) {
    throw new Error(`handshake too short: need ${HANDSHAKE_LEN} bytes, got ${buf.length}`);
  }
  const pstrlen = buf[0];
  if (pstrlen !== PSTR.length) {
    throw new Error(`unexpected pstrlen ${pstrlen}, expected ${PSTR.length}`);
  }
  const pstr = Buffer.from(buf.slice(1, 1 + PSTR.length)).toString("ascii");
  if (pstr !== PSTR) {
    throw new Error(`unexpected protocol string '${pstr}'`);
  }
  let p = 1 + PSTR.length;
  const reserved = buf.slice(p, p + 8);
  p += 8;
  const info_hash = buf.slice(p, p + 20);
  p += 20;
  const peer_id = buf.slice(p, p + 20);
  p += 20;
  return [{ reserved, info_hash, peer_id }, p];
}

// -- Messages

export function encode_message(msg: PeerMessage): Uint8Array {
  if (msg.kind === "keep_alive") {
    return u32be(0);
  }

  let body: Uint8Array;
  switch (msg.kind) {
    case "choke":
    case "unchoke":
    case "interested":
    case "not_interested":
      body = new Uint8Array(0);
      break;
    case "have":
      body = u32be(msg.piece_index);
      break;
    case "bitfield":
      body = msg.bitfield;
      break;
    case "request":
    case "cancel":
      body = concat([u32be(msg.index), u32be(msg.begin), u32be(msg.length)]);
      break;
    case "piece":
      body = concat([u32be(msg.index), u32be(msg.begin), msg.block]);
      break;
  }

  const id = MessageId[msg.kind as Exclude<PeerMessage["kind"], "keep_alive">];
  const length = 1 + body.length;
  return concat([u32be(length), Uint8Array.of(id), body]);
}

// Decodes a single message from its body — i.e. `frame` must already
// have the 4-byte length prefix stripped (as produced by `extract_frames`
// below). An empty frame decodes as a keep-alive, matching the wire
// format where keep-alives are a bare zero-length prefix with no id.
export function decode_message(frame: Uint8Array): PeerMessage {
  if (frame.length === 0) {
    return { kind: "keep_alive" };
  }

  const id = frame[0];
  const payload = frame.slice(1);

  switch (id) {
    case MessageId.choke:
      return { kind: "choke" };
    case MessageId.unchoke:
      return { kind: "unchoke" };
    case MessageId.interested:
      return { kind: "interested" };
    case MessageId.not_interested:
      return { kind: "not_interested" };
    case MessageId.have:
      expect_len(payload, 4, "have");
      return { kind: "have", piece_index: read_u32be(payload, 0) };
    case MessageId.bitfield:
      return { kind: "bitfield", bitfield: payload };
    case MessageId.request:
      expect_len(payload, 12, "request");
      return {
        kind: "request",
        index: read_u32be(payload, 0),
        begin: read_u32be(payload, 4),
        length: read_u32be(payload, 8),
      };
    case MessageId.cancel:
      expect_len(payload, 12, "cancel");
      return {
        kind: "cancel",
        index: read_u32be(payload, 0),
        begin: read_u32be(payload, 4),
        length: read_u32be(payload, 8),
      };
    case MessageId.piece:
      if (payload.length < 8) {
        throw new Error(`piece message too short: ${payload.length} bytes`);
      }
      return {
        kind: "piece",
        index: read_u32be(payload, 0),
        begin: read_u32be(payload, 4),
        block: payload.slice(8),
      };
    default:
      throw new Error(`unknown message id ${id}`);
  }
}

// -- Frame reassembly
//
// TCP gives no guarantee that a `data` event lines up with a single
// wire message: one event may contain a partial message, several
// whole messages, or a mix. Callers accumulate incoming bytes and
// call this after every chunk; it returns every complete frame found
// so far (message body, length prefix already stripped) plus
// whatever incomplete tail bytes should be kept for next time.
export function extract_frames(buffer: Uint8Array): { frames: Uint8Array[]; rest: Uint8Array } {
  const frames: Uint8Array[] = [];
  let p = 0;
  while (buffer.length - p >= 4) {
    const length = read_u32be(buffer, p);
    if (buffer.length - p < 4 + length) {
      break; // frame not fully arrived yet
    }
    frames.push(buffer.slice(p + 4, p + 4 + length));
    p += 4 + length;
  }
  return { frames, rest: buffer.slice(p) };
}

// -- Byte helpers

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function read_u32be(b: Uint8Array, pos: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(pos, false);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const res = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    res.set(part, p);
    p += part.length;
  }
  return res;
}

function expect_len(payload: Uint8Array, len: number, name: string): void {
  if (payload.length !== len) {
    throw new Error(`${name} message expects ${len} payload bytes, got ${payload.length}`);
  }
}
