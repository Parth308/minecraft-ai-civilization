/**
 * Minimal resilient RCON client for Minecraft Paper server.
 * Handles auto-reconnect, queued commands, and connection retries.
 */
const net = require('net');
const logger = require('../../shared/logger');

const TYPE = { AUTH: 3, AUTH_RES: 2, COMMAND: 2, COMMAND_RES: 0 };
const RCON_FAILURE_ID = -1;

function buildPacket(id, type, body) {
  const bodyBuf = Buffer.from(body + '\0', 'utf8');
  const len = 4 + 4 + bodyBuf.length + 1; // requestId + type + body + null
  const buf = Buffer.allocUnsafe(4 + len);
  buf.writeInt32LE(len, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeUInt8(0, 12 + bodyBuf.length); // trailing null
  return buf;
}

class RconClient {
  constructor(host, port, password) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.socket = null;
    this.authed = false;
    this.connecting = false;
    this._nextId = 1;
    this._pending = new Map();
    this._rawBuf = Buffer.alloc(0);
  }

  async connect(retries = 3, delayMs = 2000) {
    if (this.authed && this.socket && !this.socket.destroyed) return;
    if (this.connecting) return;
    this.connecting = true;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this._doConnect();
        this.connecting = false;
        logger.info('RCON', `Connected and authenticated with Minecraft RCON on ${this.host}:${this.port}`);
        return;
      } catch (err) {
        this.disconnect();
        if (attempt === retries) {
          this.connecting = false;
          throw err;
        }
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    this.connecting = false;
  }

  _doConnect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, this.host);
      this.socket.on('data', (chunk) => this._onData(chunk));
      this.socket.on('error', (err) => {
        this.disconnect();
        reject(err);
        this._rejectAll(err);
      });
      this.socket.on('close', () => {
        this.authed = false;
        this._rejectAll(new Error('RCON socket closed'));
      });
      this.socket.once('connect', async () => {
        try {
          await this._auth();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async _auth() {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.socket.write(buildPacket(id, TYPE.AUTH, this.password));
    });
  }

  async send(command) {
    if (!this.authed || !this.socket || this.socket.destroyed) {
      await this.connect(5, 2000);
    }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.socket.write(buildPacket(id, TYPE.COMMAND, command));
    });
  }

  _onData(chunk) {
    this._rawBuf = Buffer.concat([this._rawBuf, chunk]);

    while (this._rawBuf.length >= 4) {
      const len = this._rawBuf.readInt32LE(0);
      if (this._rawBuf.length < 4 + len) break;

      const id = this._rawBuf.readInt32LE(4);
      const type = this._rawBuf.readInt32LE(8);
      const body = this._rawBuf.slice(12, 4 + len - 2).toString('utf8');

      this._rawBuf = this._rawBuf.slice(4 + len);

      if (!this.authed) {
        if (id === RCON_FAILURE_ID) {
          const cb = this._pending.get(this._nextId - 1);
          if (cb) cb.reject(new Error('RCON auth failed — wrong password'));
        } else {
          this.authed = true;
          const cb = this._pending.get(id);
          if (cb) cb.resolve();
        }
      } else {
        const cb = this._pending.get(id);
        if (cb) {
          this._pending.delete(id);
          cb.resolve(body);
        }
      }
    }
  }

  _rejectAll(err) {
    for (const [, cb] of this._pending) cb.reject(err);
    this._pending.clear();
  }

  disconnect() {
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) {}
      this.socket = null;
    }
    this.authed = false;
  }
}

module.exports = RconClient;
