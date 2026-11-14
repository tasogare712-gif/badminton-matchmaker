const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const ROOMS = new Map();
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://badminton-match-table.onrender.com,http://localhost:5500,http://127.0.0.1:5500').split(',').map((x) => x.trim()).filter(Boolean));

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: ROOMS.size })); return; }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Badminton room server is running.');
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
const send = (ws, payload) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); };
const snapshot = (room) => ({ players: room.players, state: room.state });
function broadcast(room, type = 'room-update') {
  const payload = { type, code: room.code, ...snapshot(room) };
  for (const client of room.clients) send(client, payload);
}
function makeCode() {
  let code;
  do { code = Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(''); } while (ROOMS.has(code));
  return code;
}
function validName(name) { return typeof name === 'string' && name.trim().length > 0 && [...name.trim()].length <= 20; }
function attach(ws, room, name) {
  const player = { id: randomUUID(), name: name.trim() };
  room.players.push(player); room.clients.add(ws); room.lastActive = Date.now();
  ws.roomCode = room.code; ws.playerId = player.id;
  send(ws, { type: 'room', code: room.code, playerId: player.id, ...snapshot(room) });
  broadcast(room);
}
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  if (req.url !== '/ws') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { send(ws, { type: 'error', message: '送信データを読み取れません。' }); return; }
    if (message.type === 'heartbeat') return;
    if (message.type === 'create-room' || message.type === 'join-room') {
      if (!validName(message.name)) { send(ws, { type: 'error', message: '名前を1〜20文字で入力してください。' }); return; }
      if (message.type === 'create-room') {
        const code = makeCode();
        const room = { code, players: [], clients: new Set(), lastActive: Date.now(), state: { courts: 2, round: 0, matches: [] } };
        ROOMS.set(code, room); attach(ws, room, message.name); return;
      }
      const code = String(message.code || '').toUpperCase();
      const room = ROOMS.get(code);
      if (!room) { send(ws, { type: 'error', message: '部屋が見つかりません。コードを確認してください。' }); return; }
      if (room.players.length >= 100) { send(ws, { type: 'error', message: 'この部屋は満員です。' }); return; }
      if (room.players.some((player) => player.name.toLocaleLowerCase() === message.name.trim().toLocaleLowerCase())) { send(ws, { type: 'error', message: '同じ名前がすでに参加しています。別の名前を入力してください。' }); return; }
      attach(ws, room, message.name); return;
    }
    const room = ROOMS.get(ws.roomCode);
    if (!room || !room.clients.has(ws)) { send(ws, { type: 'error', message: '部屋に参加してから操作してください。' }); return; }
    room.lastActive = Date.now();
    if (message.type === 'state-update' && message.state && typeof message.state === 'object') {
      const courts = Number(message.state.courts);
      const round = Number(message.state.round);
      if (![1, 2, 3, 4].includes(courts) || !Number.isInteger(round) || round < 0 || !Array.isArray(message.state.matches)) return;
      room.state = { courts, round, matches: message.state.matches.slice(0, 300) };
      broadcast(room); return;
    }
    if (message.type === 'remove-player' && typeof message.playerId === 'string') {
      room.players = room.players.filter((player) => player.id !== message.playerId);
      room.state = { ...room.state, round: 0, matches: [] };
      broadcast(room); return;
    }
    if (message.type === 'clear-players') {
      room.players = []; room.state = { ...room.state, round: 0, matches: [] };
      broadcast(room); return;
    }
  });
  ws.on('close', () => {
    const room = ROOMS.get(ws.roomCode);
    if (room) { room.clients.delete(ws); room.lastActive = Date.now(); }
  });
});
setInterval(() => {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  for (const [code, room] of ROOMS) if (!room.clients.size && room.lastActive < cutoff) ROOMS.delete(code);
}, 10 * 60 * 1000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`Room service listening on ${PORT}`));

