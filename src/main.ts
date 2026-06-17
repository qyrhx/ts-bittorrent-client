import {Buffer} from "node:buffer";
import * as u from "./utils.js";
import * as bt from "./bittorrent.js";
import * as bc from "./bencode.js";
import * as btnet from "./bittorrent_net.js";

const arg = process.argv[2];
const [b, info_hash] = bt.read_bittorrent_file(arg || "debian-iso.torrent");

console.log(info_hash);
const url = btnet.prepare_url(b, info_hash);
console.log(url);
const resp = await fetch(url);
const data = await resp.arrayBuffer();
console.log(data);