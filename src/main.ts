import * as bc from "./bencode.js";
import * as bt from "./bittorrent.js";
import * as btnet from "./bittorrent_net.js";

const arg = process.argv[2];
const [b, info_hash] = bt.read_bittorrent_file(arg || "debian-iso.torrent");

let t: btnet.TrackerRequest = {
  announce: b.announce,
  info_hash: info_hash,
  peer_id: btnet.bittorrent_gen_peer_id(),
  port: 6881,
  uploaded: 0n,
  downloaded: 0n,
  left: BigInt(bt.total_length(b)),
  compact: true
};

const resp = await btnet.announce_to_tracker(t);
const tracker_resp = bc.bencode_decode_buff(new Uint8Array(resp));
console.log(tracker_resp);
