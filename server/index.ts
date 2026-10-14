import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { TICK, type Player, type Room } from './room.ts';
import { Rooms } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 8788);
/** Largest client message; a voice-chat SDP offer is a few KB. */
const MAX_PAYLOAD = 64 * 1024;
/** Ping period; a socket that misses a pong is dropped, so a vanished player doesn't hold up the exit. */
const HEARTBEAT_MS = 15_000;
const DIST = join(import.meta.dirname, '../dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// In production one process serves both the built client (npm run build) and the WebSocket.
const http = createServer((req, res) => {
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Клиент не собран: npm run build, или откройте страницу через npm run dev');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const rooms = new Rooms();
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_PAYLOAD });
const alive = new WeakSet<WebSocket>();

wss.on('connection', (ws) => {
  let session: { room: Room; player: Player } | null = null;
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  ws.on('error', () => ws.terminate());
  const send = (msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    // Shapes are checked field by field where they are used; here only that it is a message at all
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
    if (session) {
      session.room.onMessage(session.player, msg);
      return;
    }
    if (msg.t !== 'join') return;
    const res = rooms.join(msg, send);
    if ('error' in res) {
      send({ t: 'error', text: res.error });
      ws.close();
      return;
    }
    session = res;
    console.log(`"${res.player.name}" joined ${res.room.code} (${rooms.stats})`);
  });

  ws.on('close', () => {
    if (!session) return;
    rooms.leave(session.room, session.player);
    console.log(`"${session.player.name}" left ${session.room.code} (${rooms.stats})`);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, HEARTBEAT_MS);

setInterval(() => rooms.tick(), TICK * 1000);
http.listen(PORT, () => console.log(`yacheika server on :${PORT}`));
