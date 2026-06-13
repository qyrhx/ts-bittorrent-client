import * as bt from "./bittorrent.js";
import {Buffer} from "node:buffer";

// const b = Buffer.from("Hello there!");
// console.log(b.toString());

const t = bt.read_bittorrent_file("debian-iso.torrent")
console.log(t.info.pieces.length);
console.log(t);