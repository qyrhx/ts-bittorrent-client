import * as bt from "./bittorrent.js"
import * as bc from "./bencode.js"
import * as u from "./utils.js"
import * as c from "node:crypto"

export function bittorrent_gen_peer_id(): Uint8Array {
  return c.randomBytes(20);
}

export function prepare_url(b: bt.Bittorrent, info_hash: Uint8Array): string {
  const peer_id = u.escape_bytes(bittorrent_gen_peer_id());
  let left = (b.info as bt.SingleFileInfo).len.toString();
  const url =
    b.announce +
    "?info_hash=" + u.escape_bytes(info_hash) +
    "&peer_id=" + peer_id +
    "&port=6881" +
    "&uploaded=0" +
    "&downloaded=0" +
    "&left=" + left +
    "&compact=1";
    return url;
}