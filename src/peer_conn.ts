// Real TCP networking for a single peer connection: opens the socket,
// performs the handshake, and turns the raw byte stream into decoded
// PeerMessage events using the pure logic in peer_wire.ts. Kept separate
// from peer_wire.ts the same way bittorrent_net.ts's networking is kept
// separate from bencode.ts's pure decoding.
import * as net from "node:net";
import { EventEmitter } from "node:events";
import * as pw from "./peer_wire.js";

export type ConnectOptions = {
  // Max time to wait for the TCP connection AND the peer's handshake
  // to complete, combined. Peers that never respond are common (dead,
  // firewalled, overloaded) so this must not hang forever.
  timeout_ms?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * A single connection to one peer. Emits:
 *   - "message" (msg: PeerMessage) for every decoded message after the handshake
 *   - "error" (err: Error) for socket-level errors after the connection is established
 *   - "close" () when the underlying socket closes
 *
 * am_choking/am_interested reflect state WE have told the peer (via send_*
 * below); peer_choking/peer_interested reflect state the PEER has told US,
 * and are updated automatically as choke/unchoke/interested/not_interested
 * messages arrive.
 */
export class PeerConnection extends EventEmitter {
  readonly ip: string;
  readonly port: number;
  readonly info_hash: Uint8Array;
  readonly my_peer_id: Uint8Array;
  remote_peer_id: Uint8Array | null = null;

  am_choking = true;
  am_interested = false;
  peer_choking = true;
  peer_interested = false;

  private socket: net.Socket;
  private handshake_done = false;
  private recv_buffer: Uint8Array = new Uint8Array(0);

  private constructor(socket: net.Socket, info_hash: Uint8Array, my_peer_id: Uint8Array, ip: string, port: number) {
    super();
    this.socket = socket;
    this.info_hash = info_hash;
    this.my_peer_id = my_peer_id;
    this.ip = ip;
    this.port = port;
  }

  /**
   * Opens a TCP connection to the peer, sends our handshake, and resolves
   * once the peer's handshake has arrived and its info_hash has been
   * verified to match ours. Rejects on connection failure, a mismatched
   * info_hash, a malformed handshake, or timeout.
   */
  static connect(ip: string, port: number, info_hash: Uint8Array, my_peer_id: Uint8Array, opts: ConnectOptions = {}): Promise<PeerConnection> {
    const timeout_ms = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: ip, port });
      const conn = new PeerConnection(socket, info_hash, my_peer_id, ip, port);

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`connection/handshake with ${ip}:${port} timed out after ${timeout_ms}ms`));
      }, timeout_ms);

      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          socket.destroy();
          reject(err);
        } else {
          resolve(conn);
        }
      };

      socket.on("error", (err) => {
        if (settled) {
          conn.emit("error", err); // post-handshake: surface to caller, don't reject twice
        } else {
          finish(err);
        }
      });

      socket.on("close", () => conn.emit("close"));

      socket.once("connect", () => {
        socket.write(Buffer.from(pw.encode_handshake(info_hash, my_peer_id)));
      });

      socket.on("data", (chunk: Buffer) => {
        if (!settled) {
          try {
            conn._on_data(chunk);
          } catch (err) {
            finish(err as Error);
            return;
          }
          if (conn.handshake_done) {
            finish(null);
          }
        } else {
          try {
            conn._on_data(chunk);
          } catch (err) {
            conn.emit("error", err as Error); // finish() would no-op silently here; surface it instead
          }
        }
      });
    });
  }

  private _on_data(chunk: Buffer): void {
    this.recv_buffer = concat(this.recv_buffer, chunk);

    if (!this.handshake_done) {
      // Wait for at least a full handshake before attempting to parse one.
      if (this.recv_buffer.length < 68) return;

      const [hs, consumed] = pw.decode_handshake(this.recv_buffer);
      if (!buffers_equal(hs.info_hash, this.info_hash)) {
        throw new Error(
          `peer ${this.ip}:${this.port} sent mismatched info_hash`
        );
      }
      this.remote_peer_id = hs.peer_id;
      this.handshake_done = true;
      this.recv_buffer = this.recv_buffer.slice(consumed);
      this.emit("handshake", hs);

      if (this.recv_buffer.length > 0) {
        // The peer packed extra messages (e.g. a bitfield) into the same
        // TCP chunk as its handshake. Defer decoding them to the next
        // event-loop tick: a caller doing `const conn = await
        // PeerConnection.connect(...)` only gets to attach "message"
        // listeners in the microtask *after* this handler returns and the
        // connect() promise resolves, so emitting synchronously here would
        // fire before anyone is listening and the messages would be lost.
        setImmediate(() => {
          try {
            this._process_buffered();
          } catch (err) {
            this.emit("error", err as Error);
          }
        });
      }
      return;
    }

    this._process_buffered();
  }

  private _process_buffered(): void {
    const { frames, rest } = pw.extract_frames(this.recv_buffer);
    this.recv_buffer = rest;
    for (const frame of frames) {
      const msg = pw.decode_message(frame);
      this._apply_incoming_state(msg);
      this.emit("message", msg);
    }
  }

  private _apply_incoming_state(msg: pw.PeerMessage): void {
    switch (msg.kind) {
      case "choke":
        this.peer_choking = true;
        break;
      case "unchoke":
        this.peer_choking = false;
        break;
      case "interested":
        this.peer_interested = true;
        break;
      case "not_interested":
        this.peer_interested = false;
        break;
    }
  }

  send(msg: pw.PeerMessage): void {
    this.socket.write(Buffer.from(pw.encode_message(msg)));
  }

  send_choke(): void {
    this.am_choking = true;
    this.send({ kind: "choke" });
  }

  send_unchoke(): void {
    this.am_choking = false;
    this.send({ kind: "unchoke" });
  }

  send_interested(): void {
    this.am_interested = true;
    this.send({ kind: "interested" });
  }

  send_not_interested(): void {
    this.am_interested = false;
    this.send({ kind: "not_interested" });
  }

  request_block(index: number, begin: number, length: number): void {
    this.send({ kind: "request", index, begin, length });
  }

  close(): void {
    this.socket.destroy();
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const res = new Uint8Array(a.length + b.length);
  res.set(a, 0);
  res.set(b, a.length);
  return res;
}

function buffers_equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
