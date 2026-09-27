import * as u from "./utils.js"
import * as bc from "./bencode.js"
import { Buffer } from "node:buffer"
import * as c from "node:crypto"

export type TrackerRequest = {
  announce: string,
  info_hash: Uint8Array;
  peer_id: Uint8Array;
  port: number;
  uploaded: bigint;
  downloaded: bigint;
  left: bigint;
  compact: boolean;
};

export type Peer = {
  ip: string;
  port: number;
};

export type TrackerResponse = {
  interval: number;
  peers: Peer[];
  complete?: number;
  incomplete?: number;
  warning_message?: string;
};

/**
 * Hit the tracker's announce endpoint and return its (still-bencoded)
 * response body. This does NOT download any file data — the tracker
 * only replies with a peer list, interval, etc. Actually downloading
 * pieces requires the separate peer wire protocol.
 */
export async function announce_to_tracker(t: TrackerRequest): Promise<ArrayBuffer> {
  const url = url_from_tracker_req(t);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`tracker request failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.arrayBuffer();
}

export function bittorrent_gen_peer_id(): Uint8Array {
  return c.randomBytes(20);
}

// Parses the compact peer format we requested with `compact=1`: a single
// byte string, 6 bytes per peer — 4-byte big-endian IPv4 address followed
// by a 2-byte big-endian port.
export function parse_compact_peers(peers: Uint8Array): Peer[] {
  if (peers.length % 6 !== 0) {
    throw new Error(`compact peers field length ${peers.length} is not a multiple of 6`);
  }
  const res: Peer[] = [];
  for (let i = 0; i < peers.length; i += 6) {
    const ip = `${peers[i]}.${peers[i + 1]}.${peers[i + 2]}.${peers[i + 3]}`;
    const port = (peers[i + 4] << 8) | peers[i + 5];
    res.push({ ip, port });
  }
  return res;
}

// Some trackers ignore `compact=1` and reply with the original
// list-of-dicts peer format instead: [{ "ip": ..., "port": ..., "peer id": ... }, ...]
function parse_dict_peers(list: bc.BencodeVal[]): Peer[] {
  const res: Peer[] = [];
  for (const item of list) {
    u.throw_if_val_wrong_type(item instanceof Map);
    const d = item as bc.BencodeDict;
    u.throw_if_not_has(d, "ip");
    u.throw_if_not_has(d, "port");
    const ipVal = d.get("ip")!;
    const ip = ipVal instanceof Uint8Array ? Buffer.from(ipVal).toString() : String(ipVal);
    u.throw_if_val_wrong_type(typeof d.get("port") === "number");
    res.push({ ip, port: d.get("port")! as number });
  }
  return res;
}

// Decodes a tracker's bencoded announce response into a structured form,
// handling both the compact and list-of-dicts peer formats, and surfacing
// a tracker-side "failure reason" as a thrown Error.
export function parse_tracker_response(resp: bc.BencodeVal): TrackerResponse {
  u.throw_if_val_wrong_type(resp instanceof Map);
  const d = resp as bc.BencodeDict;

  if (d.has("failure reason")) {
    const reason = d.get("failure reason")! as Uint8Array;
    throw new Error(`tracker returned failure: ${Buffer.from(reason).toString()}`);
  }

  u.throw_if_not_has(d, "interval");
  u.throw_if_val_wrong_type(typeof d.get("interval") === "number");
  const interval = d.get("interval")! as number;

  u.throw_if_not_has(d, "peers");
  const peersVal = d.get("peers")!;
  let peers: Peer[];
  if (peersVal instanceof Uint8Array) {
    peers = parse_compact_peers(peersVal);
  } else {
    u.throw_if_val_wrong_type(Array.isArray(peersVal));
    peers = parse_dict_peers(peersVal as bc.BencodeVal[]);
  }

  const res: TrackerResponse = { interval, peers };
  if (typeof d.get("complete") === "number") res.complete = d.get("complete") as number;
  if (typeof d.get("incomplete") === "number") res.incomplete = d.get("incomplete") as number;
  if (d.has("warning message")) {
    res.warning_message = Buffer.from(d.get("warning message")! as Uint8Array).toString();
  }
  return res;
}

export function url_from_tracker_req(t: TrackerRequest): string {
  const url =
    t.announce +
    "?info_hash=" + u.escape_bytes(t.info_hash) +
    "&peer_id=" + u.escape_bytes(t.peer_id) +
    "&port=" + t.port +
    "&uploaded=" + t.uploaded +
    "&downloaded=" + t.downloaded +
    "&left=" + t.left +
    "&compact=1";
    return url;
}
