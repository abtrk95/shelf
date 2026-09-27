/** Shelf's signaling service. It never receives transfer payloads or filenames. */
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const list = (value = '') => value.split(',').map(s => s.trim()).filter(Boolean);
const integer = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('Invalid numeric server configuration.');
  return n;
};
class HttpError extends Error { constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; } }
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
const opaque = (length = 24) => randomBytes(length).toString('base64url');
const equalSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function normalizeCode(value) { return typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : ''; }
export function cleanName(value) {
  if (typeof value !== 'string') return 'Another browser';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 40) || 'Another browser';
}
export function cleanDeviceId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
    ? value.toLowerCase()
    : randomUUID();
}

export function createShelfServer(overrides = {}) {
  const env = process.env;
  const config = {
    production: env.NODE_ENV === 'production',
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    trustProxy: env.TRUST_PROXY === 'true',
    sessionTTL: integer(env.SESSION_TTL_SECONDS, 1800, 1, 7200) * 1000,
    inviteTTL: integer(env.INVITE_TTL_SECONDS, 600, 1, 1800) * 1000,
    maxSessions: integer(env.MAX_SESSIONS, 2000, 2, 100000),
    maxFileBytes: integer(env.MAX_FILE_BYTES, 2147483648, 1, 2147483648),
    stunUrls: list(env.STUN_URLS ?? 'stun:stun.cloudflare.com:3478'),
    turnUrls: list(env.TURN_URLS), turnSecret: env.TURN_SECRET || '',
    iceTransportPolicy: env.ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all',
    now: () => Date.now(), ...overrides,
  };
  if (config.production && !config.allowedOrigins.length) throw new Error('Set ALLOWED_ORIGINS to your HTTPS origin for production.');
  if (config.production && config.allowedOrigins.some(o => !o.startsWith('https://'))) throw new Error('Production origins must use HTTPS.');
  if (config.turnUrls.length && !config.turnSecret) throw new Error('TURN_URLS requires TURN_SECRET.');
  if (config.iceTransportPolicy === 'relay' && !config.turnUrls.length) throw new Error('Relay-only mode requires TURN configuration.');
  const sessions = new Map(); const ids = new Map(); const rooms = new Map(); const codes = new Map(); const buckets = new Map();
  let stopped = false;

  function rate(key, limit, window = 60000) {
    const now = config.now(); let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) { if (buckets.size >= 10000 && !bucket) fail(503, 'Please try again shortly.'); bucket = { count: 0, until: now + window }; buckets.set(key, bucket); }
    if (++bucket.count > limit) fail(429, 'Too many attempts. Wait a minute, then try again.', 'rate_limited');
  }
  function send(client, type, data = {}) {
    if (!client) return;
    const event = { seq: ++client.sequence, type, ...data };
    const frame = `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
    client.history.push(frame); client.historyBytes += Buffer.byteLength(frame);
    while (client.history.length > 32 || client.historyBytes > 65536) client.historyBytes -= Buffer.byteLength(client.history.shift());
    if (client.stream && !client.stream.destroyed) {
      if (client.stream.writableLength > 262144) client.stream.destroy();
      else client.stream.write(frame);
    }
  }
  function iceServers(client) {
    const servers = config.stunUrls.length ? [{ urls: config.stunUrls }] : [];
    if (config.turnUrls.length) {
      const username = `${Math.ceil((client.createdAt + 7200000 + 600000) / 1000)}:${client.id}`;
      servers.push({ urls: config.turnUrls, username, credential: createHmac('sha1', config.turnSecret).update(username).digest('base64') });
    }
    return servers;
  }
  function other(client) {
    const room = rooms.get(client.roomId);
    return room ? ids.get(room.owner === client.id ? room.guest : room.owner) : undefined;
  }
  function roomState(client) {
    const room = rooms.get(client.roomId);
    if (!room) return { ended: true };
    const peer = other(client);
    return {
      roomId: room.id, expiresAt: room.expiresAt,
      owner: room.owner === client.id,
      ...(peer ? { peer: { id: peer.id, name: peer.name, deviceId: peer.deviceId, online: !!peer.stream }, initiator: room.owner === client.id } : {}),
      ...(room.owner === client.id && !room.guest ? { code: room.code, inviteSecret: room.secret, inviteExpiresAt: room.inviteExpiresAt } : {}),
    };
  }
  function snapshot(client) { send(client, 'snapshot', { state: roomState(client) }); }
  function sessionPayload(client) {
    return {
      token: client.token, id: client.id, name: client.name, deviceId: client.deviceId,
      state: roomState(client),
      config: { iceServers: iceServers(client), iceTransportPolicy: config.iceTransportPolicy, maxFileBytes: config.maxFileBytes },
    };
  }
  function rotateInvite(room) {
    if (room.code) codes.delete(room.code);
    let code;
    do { code = Array.from(randomBytes(8), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''); } while (codes.has(code));
    room.code = code; room.secret = opaque(); room.inviteExpiresAt = Math.min(config.now() + config.inviteTTL, room.expiresAt);
    codes.set(code, room.id);
  }
  function endRoom(room, reason = 'ended') {
    if (!room) return;
    codes.delete(room.code); rooms.delete(room.id);
    for (const id of [room.owner, room.guest]) {
      const client = ids.get(id);
      if (client) { client.roomId = null; send(client, 'ended', { reason }); }
    }
  }
  function auth(req) {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const client = token && sessions.get(token);
    if (!client || client.expiresAt <= config.now()) fail(401, 'Your session has expired. Start a new one.', 'session_expired');
    client.lastSeen = config.now(); return client;
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Use a JSON request.');
    if (Number(req.headers['content-length']) > 65536) fail(413, 'Request is too large.');
    let bytes = 0; const chunks = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) fail(413, 'Request is too large.'); chunks.push(chunk); }
    try { const result = JSON.parse(Buffer.concat(chunks).toString()); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; }
    catch { fail(400, 'Invalid JSON request.'); }
  }
  function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
  function validateOrigin(req, required) {
    const origin = req.headers.origin;
    if (!origin) { if (required) fail(403, 'An origin is required.'); return; }
    let valid = config.allowedOrigins.includes(origin);
    if (!config.allowedOrigins.length && !config.production) {
      try { const parsed = new URL(origin); valid = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === req.headers.host; } catch { /* Reject malformed origins. */ }
    }
    if (!valid) fail(403, 'This origin is not allowed.');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; media-src 'none'");
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const ip = config.trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
      if (path === '/healthz' && req.method === 'GET') return json(res, { status: 'ok', version: '1.1.0' });
      if (path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        validateOrigin(req, req.method === 'POST');
        if (req.method === 'POST' && path === '/api/session') {
          rate(`create:${ip}`, 20);
          if (sessions.size >= config.maxSessions) fail(503, 'Shelf is at capacity. Please try again shortly.');
          const input = await body(req); const now = config.now();
          const token = opaque(32); const id = randomUUID();
          const client = { id, name: cleanName(input.name), deviceId: cleanDeviceId(input.deviceId), token, roomId: opaque(12), createdAt: now, lastSeen: now, expiresAt: now + config.sessionTTL, stream: null, sequence: 0, history: [], historyBytes: 0 };
          const room = { id: client.roomId, owner: id, guest: null, expiresAt: client.expiresAt };
          sessions.set(token, client); ids.set(id, client); rooms.set(room.id, room); rotateInvite(room);
          return json(res, sessionPayload(client), 201);
        }
        const client = auth(req);
        if (path === '/api/events' && req.method === 'GET') {
          rate(`stream:${client.id}`, 40);
          client.stream?.end(); client.stream = res;
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(': shelf\n\n');
          const last = Number(req.headers['last-event-id'] || 0);
          if (last) for (const frame of client.history) if (Number(frame.slice(4, frame.indexOf('\n'))) > last) res.write(frame);
          snapshot(client);
          if (other(client)) send(other(client), 'peer-online');
          const beat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000); beat.unref();
          res.on('close', () => { clearInterval(beat); if (client.stream === res) { client.stream = null; send(other(client), 'peer-offline'); } });
          return;
        }
        if (req.method !== 'POST') fail(405, 'Method not allowed.');
        rate(`command:${client.id}`, 240);
        const input = await body(req);
        if (path === '/api/resume') {
          rate(`resume:${client.id}`, 30);
          const now = config.now();
          let room = rooms.get(client.roomId);
          if (!room) {
            client.roomId = opaque(12);
            client.expiresAt = Math.min(now + config.sessionTTL, client.createdAt + 7200000);
            room = { id: client.roomId, owner: client.id, guest: null, expiresAt: client.expiresAt };
            rooms.set(room.id, room);
            rotateInvite(room);
          } else {
            const members = [ids.get(room.owner), ids.get(room.guest)].filter(Boolean);
            const maximum = Math.min(...members.map(member => member.createdAt + 7200000));
            room.expiresAt = Math.min(now + config.sessionTTL, maximum);
            for (const id of [room.owner, room.guest]) {
              const member = ids.get(id);
              if (member) member.expiresAt = room.expiresAt;
            }
          }
          snapshot(other(client));
          return json(res, sessionPayload(client));
        }
        if (path === '/api/join') {
          rate(`join:${ip}`, 8); rate(`join-session:${client.id}`, 8);
          if (other(client)) fail(409, 'End your current connection before joining another.');
          let room;
          if (typeof input.code === 'string') room = rooms.get(codes.get(normalizeCode(input.code)));
          else if (typeof input.roomId === 'string' && typeof input.secret === 'string') {
            const candidate = rooms.get(input.roomId);
            if (candidate && equalSecret(candidate.secret, input.secret)) room = candidate;
          }
          if (!room || room.inviteExpiresAt <= config.now() || room.expiresAt <= config.now() || room.guest) fail(404, 'That code is unavailable. Ask the other device for a new one.', 'invalid_code');
          if (room.owner === client.id) fail(400, 'Open Shelf on your other device and enter this code there.');
          const owner = ids.get(room.owner);
          if (!owner?.stream || owner.expiresAt <= config.now()) fail(409, 'The other device is offline. Keep Shelf open on both devices.');
          // Possession of the expiring invitation authorizes this two-device connection.
          // No awaits in this section: two simultaneous joins cannot claim the same room.
          const previousRoom = rooms.get(client.roomId);
          if (previousRoom) { codes.delete(previousRoom.code); rooms.delete(previousRoom.id); }
          client.roomId = room.id; room.guest = client.id;
          room.expiresAt = Math.min(config.now() + config.sessionTTL, owner.createdAt + 7200000, client.createdAt + 7200000);
          owner.expiresAt = client.expiresAt = room.expiresAt;
          codes.delete(room.code); room.secret = undefined; room.code = undefined;
          snapshot(owner); snapshot(client);
          return json(res, { paired: true, state: roomState(client) });
        }
        if (path === '/api/signal') {
          const peer = other(client); if (!peer) fail(409, 'Connect a device first.');
          const signal = input.signal;
          if (!signal || typeof signal !== 'object' || !['offer', 'answer', 'candidate', 'restart'].includes(signal.type) || typeof signal.connectionId !== 'string' || signal.connectionId.length > 64) fail(400, 'Invalid connection message.');
          if (['offer', 'answer'].includes(signal.type) && (typeof signal.sdp !== 'string' || signal.sdp.length > 20000)) fail(400, 'Invalid connection description.');
          if (signal.type === 'candidate' && (!signal.candidate || typeof signal.candidate !== 'object' || typeof signal.candidate.candidate !== 'string' || signal.candidate.candidate.length > 2048)) fail(400, 'Invalid network candidate.');
          // Forward only protocol fields, never arbitrary extra request properties.
          const safe = { type: signal.type, connectionId: signal.connectionId };
          if (signal.sdp) safe.sdp = signal.sdp;
          if (signal.type === 'candidate') safe.candidate = { candidate: signal.candidate.candidate, sdpMid: typeof signal.candidate.sdpMid === 'string' ? signal.candidate.sdpMid.slice(0, 64) : null, sdpMLineIndex: Number.isInteger(signal.candidate.sdpMLineIndex) ? signal.candidate.sdpMLineIndex : null };
          send(peer, 'signal', { signal: safe }); return json(res, { ok: true });
        }
        if (path === '/api/invite') {
          const room = rooms.get(client.roomId); if (!room || room.owner !== client.id || room.guest) fail(409, 'An invitation is not available in this session.');
          rate(`invite:${client.id}`, 10);
          rotateInvite(room); snapshot(client); return json(res, { ok: true });
        }
        if (path === '/api/name') {
          client.name = cleanName(input.name); snapshot(client); if (other(client)) snapshot(other(client)); return json(res, { name: client.name });
        }
        if (path === '/api/extend') {
          const room = rooms.get(client.roomId); if (!room) fail(409, 'Start a new session.');
          rate(`extend:${room.id}`, 3);
          const maximum = Math.min(...[ids.get(room.owner), ids.get(room.guest)].filter(Boolean).map(c => c.createdAt + 7200000));
          room.expiresAt = Math.min(config.now() + config.sessionTTL, maximum);
          for (const id of [room.owner, room.guest]) { const c = ids.get(id); if (c) { c.expiresAt = room.expiresAt; snapshot(c); } }
          return json(res, { ok: true });
        }
        if (path === '/api/end') { endRoom(rooms.get(client.roomId)); return json(res, { ok: true }); }
        fail(404, 'Endpoint not found.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Method not allowed.');
      const relative = path === '/' ? '/index.html' : decodeURIComponent(path);
      const target = resolve(ROOT, `.${relative}`);
      if (!target.startsWith(ROOT + sep) || !CONTENT_TYPES[extname(target)]) fail(404, 'Not found.');
      let actual; try { actual = await realpath(target); } catch { fail(404, 'Not found.'); }
      if (!actual.startsWith(ROOT + sep)) fail(404, 'Not found.');
      const info = await stat(actual); if (!info.isFile()) fail(404, 'Not found.');
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(target)], 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(actual));
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 429) res.setHeader('Retry-After', '60');
      json(res, { error: error instanceof HttpError ? error.message : 'Something went wrong. Please try again.', code: error instanceof HttpError ? error.code : 'server_error' }, status);
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 65000;
  function sweep() {
    const now = config.now();
    for (const room of [...rooms.values()]) if (room.expiresAt <= now) endRoom(room, 'expired');
    for (const [token, client] of sessions) if (client.expiresAt <= now) { client.stream?.end(); sessions.delete(token); ids.delete(client.id); }
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  }
  const timer = setInterval(sweep, 1000); timer.unref();
  async function close() {
    if (stopped) return; stopped = true; clearInterval(timer);
    for (const client of ids.values()) client.stream?.end();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
  return { server, close, sweep, config };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createShelfServer(); const port = integer(process.env.PORT, 3000, 1, 65535);
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Shelf is ready on port ${port}. No content logging is enabled.`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
