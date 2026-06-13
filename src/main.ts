import * as bt from "./bittorrent.js";
import {Buffer} from "node:buffer";
import * as utils from "./utils.js";

// const b = Buffer.from("Hello there!");
// console.log(b.toString());

const arg = process.argv[2];
const t = bt.read_bittorrent_file(arg || "debian-iso.torrent");
console.log(utils.prettyPrintTorrent(t));