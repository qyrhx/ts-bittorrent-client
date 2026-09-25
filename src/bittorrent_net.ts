import * as u from "./utils.js"
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
