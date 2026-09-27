import * as bc from "./bencode.js";
import * as bt from "./bittorrent.js";
import * as btnet from "./bittorrent_net.js";
import { PeerConnection } from "./peer_conn.js";
import { download_from_peer } from "./downloader.js";

const arg = process.argv[2];
const out_dir = process.argv[3] || ".";
const [b, info_hash] = bt.read_bittorrent_file(arg || "debian-iso.torrent");
const my_peer_id = btnet.bittorrent_gen_peer_id();

let t: btnet.TrackerRequest = {
  announce: b.announce,
  info_hash: info_hash,
  peer_id: my_peer_id,
  port: 6881,
  uploaded: 0n,
  downloaded: 0n,
  left: BigInt(bt.total_length(b)),
  compact: true
};

let resp: ArrayBuffer;
try {
  resp = await btnet.announce_to_tracker(t);
} catch (err) {
  console.error(`Failed to reach tracker '${t.announce}':`, (err as Error).message);
  process.exit(1);
}

const decoded = bc.bencode_decode_buff(new Uint8Array(resp));
const tracker_resp = btnet.parse_tracker_response(decoded);
console.log(`Tracker returned ${tracker_resp.peers.length} peer(s), reannounce in ${tracker_resp.interval}s`);

if (tracker_resp.peers.length === 0) {
  console.error("No peers available from tracker.");
  process.exit(1);
}

// Single-peer download: try peers in order until one completes a
// handshake, then download the whole torrent from it. No parallelism
// across peers and no request pipelining yet — see the note below.
let conn: PeerConnection | null = null;
for (const peer of tracker_resp.peers) {
  console.log(`Connecting to ${peer.ip}:${peer.port}...`);
  try {
    conn = await PeerConnection.connect(peer.ip, peer.port, info_hash, my_peer_id, { timeout_ms: 8000 });
    console.log(`Connected to ${peer.ip}:${peer.port}`);
    break;
  } catch (err) {
    console.log(`  failed: ${(err as Error).message}`);
  }
}

if (conn === null) {
  console.error("Could not connect to any peer.");
  process.exit(1);
}

try {
  await download_from_peer(b, conn, out_dir, {
    on_progress: (piece_index, total) => {
      const pct = (((piece_index + 1) / total) * 100).toFixed(1);
      process.stdout.write(`\rDownloaded piece ${piece_index + 1}/${total} (${pct}%)`);
    },
  });
  process.stdout.write("\n");
  console.log("Download complete.");
} catch (err) {
  process.stdout.write("\n");
  console.error(`Download failed: ${(err as Error).message}`);
  process.exit(1);
} finally {
  conn.close();
}

// NOTE on what's still missing for a "real" client:
//  - Only ever tries ONE peer at a time, sequentially, and gives up
//    entirely if that peer doesn't have every piece.
//  - No parallelism: pieces (and blocks within a piece) are requested
//    one at a time, stop-and-wait, rather than pipelined or spread
//    across multiple simultaneous peer connections.
//  - No rarest-first or any smarter piece selection — pieces are always
//    requested in index order.
//  - No resume support: re-running always re-downloads from piece 0
//    (though file_writer.ts's file sizing is already resume-friendly).
//  - No seeding/uploading — this is download-only.
