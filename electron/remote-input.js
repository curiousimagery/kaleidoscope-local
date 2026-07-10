// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// electron/remote-input.js — the mobile gesture-input server (Arc 6).
//
// The Electron shell hosts a tiny HTTP + WebSocket server on the LAN so an
// iPhone/iPad can act as a gesture INPUT DEVICE for Fold (public-HTTPS pages
// can't open ws:// to a LAN IP — mixed content — so the desktop app serving
// the page itself is the pairing answer). The page (remote-page.html) is
// self-contained; its same-origin WebSocket is the control link. A per-start
// token in the URL gates both the page and the socket.
//
// The WebSocket side is a deliberately MINIMAL hand-rolled server (no new
// dependency): handshake + masked client frames (text/close/ping), unmasked
// server frames. Messages are small JSON gesture deltas at touch rate.

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

let server = null;
let token = '';
const clients = new Set();
let onMessage = null;   // (obj) => void
let onStatus = null;    // ({ clients }) => void

function lanIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
}

function notifyStatus() { onStatus?.({ clients: clients.size }); }

// server → client text frame (unmasked per RFC 6455)
function sendFrame(sock, data, op = 1) {
  const buf = Buffer.from(data);
  let head;
  if (buf.length < 126) head = Buffer.from([0x80 | op, buf.length]);
  else if (buf.length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(buf.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(buf.length), 2); }   // overlay PNGs can pass 64KB
  try { sock.write(Buffer.concat([head, buf])); } catch { /* closing */ }
}

function handleSocket(sock) {
  clients.add(sock);
  notifyStatus();
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    // drain complete frames (client → server frames are always masked)
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (masked) {
        const mask = buf.subarray(maskOff, maskOff + 4);
        const un = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
        payload = un;
      }
      buf = buf.subarray(off + len);
      if (op === 8) { sock.end(); return; }                       // close
      if (op === 9) { sendFrame(sock, payload, 10); continue; }   // ping → pong
      if (op === 1) {
        try { onMessage?.(JSON.parse(payload.toString('utf8'))); } catch { /* malformed — drop */ }
      }
    }
  });
  const drop = () => { clients.delete(sock); notifyStatus(); };
  sock.on('close', drop);
  sock.on('error', drop);
}

module.exports = {
  // start (idempotent) → { url } to show the performer
  start() {
    if (server) return Promise.resolve({ url: `http://${lanIPv4()}:${server.address().port}/?k=${token}` });
    token = crypto.randomBytes(4).toString('hex');
    const page = fs.readFileSync(path.join(__dirname, 'remote-page.html'), 'utf8');
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/' && u.searchParams.get('k') === token) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(page);
      } else {
        res.writeHead(403); res.end('fold: pair from the desktop app');
      }
    });
    server.on('upgrade', (req, sock) => {
      const u = new URL(req.url, 'http://x');
      const key = req.headers['sec-websocket-key'];
      if (u.pathname !== '/ws' || u.searchParams.get('k') !== token || !key) { sock.destroy(); return; }
      const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
        + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      handleSocket(sock);
    });
    return new Promise((resolve, reject) => {
      server.once('error', (e) => { server = null; reject(e); });
      server.listen(0, '0.0.0.0', () => {
        resolve({ url: `http://${lanIPv4()}:${server.address().port}/?k=${token}` });
      });
    });
  },
  stop() {
    for (const c of clients) { try { c.destroy(); } catch { /* closing */ } }
    clients.clear();
    if (server) { try { server.close(); } catch { /* closing */ } server = null; }
    notifyStatus();
  },
  setHandlers({ message, status }) { onMessage = message; onStatus = status; },
  // desktop → phone push (the state stream: slice polygons, canvas rot/zoom)
  broadcast(obj) {
    if (!clients.size) return;
    const data = JSON.stringify(obj);
    for (const c of clients) sendFrame(c, data);
  },
  get clients() { return clients.size; },
};
