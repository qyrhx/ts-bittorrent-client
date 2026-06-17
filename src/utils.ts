import { Bittorrent } from "./bittorrent.js";

export function escape_bytes(bytes: Uint8Array): string {
  return [...bytes]
    .map(b => "%" + b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

export function prettyPrintTorrent(t: Bittorrent): string {
  const info = t.info;

  const piecesCount = info.pieces.length;

  let out = "";

  out += `Announce: ${t.announce}\n\n`;

  if ("files" in info) {
    out += `Type: multi-file\n`;
    out += `Destination dir: ${info.dest_dir}\n`;
    out += `Files: ${info.files.length}\n\n`;

    const totalSize = info.files.reduce((a, f) => a + f.len, 0);
    out += `Total size: ${totalSize} bytes\n`;
    out += `Piece length: ${info.piece_len}\n`;
    out += `Pieces: ${piecesCount}\n\n`;

    for (const f of info.files) {
      out += `- ${f.path.join("/")}\t(${f.len} bytes)\n`;
    }
  } else {
    out += `Type: single-file\n`;
    out += `Name: ${info.name}\n`;
    out += `Size: ${info.len} bytes\n`;
    out += `Piece length: ${info.piece_len}\n`;
    out += `Pieces: ${piecesCount}\n`;
  }

  return out;
}

export function throw_if_not_has(d: Map<string, unknown>, k: string): void {
  if (!d.has(k))
    throw Error(`'${k}' does not exist in dictionary ${d}`);
}

export function throw_if_val_wrong_type(pred: boolean): void {
  if (!pred)
    throw Error(`Type error.`);
}