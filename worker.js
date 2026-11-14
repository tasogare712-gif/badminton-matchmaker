const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const ROOM_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_ORIGINS = new Set(['https://badminton-match-table.onrender.com']);

function json(data, status = 200, origin = null) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
    headers['vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
}
function validName(name) { return typeof name === 'string' && name.trim().length > 0 && [...name.trim()].length <= 20; }
function randomCode() { const bytes = new Uint8Array(6); crypto.getRandomValues(bytes); return [...bytes].map((byte) => ROOM_CHARS[byte % ROOM_CHARS.length]).join(''); }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const originAllowed = !origin || origin === url.origin || ROOM_ORIGINS.has(origin);
    if (!originAllowed) return json({ message: 'このサイトからの接続は許可されていません。' }, 403);

    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/api/rooms' && request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 204 });
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'Origin' } });
    }
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return json({ message: '入力を読み取れません。' }, 400, origin); }
      if (!validName(body.name)) return json({ message: '名前を1〜20文字で入力してください。' }, 400, origin);
      const action = body.action;
      if (!['create-room', 'join-room'].includes(action)) return json({ message: '操作を選択してください。' }, 400, origin);
      const code = action === 'create-room' ? randomCode() : String(body.code || '').toUpperCase();
      if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(code)) return json({ message: '部屋コードは6文字で入力してください。' }, 400, origin);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const response = await stub.fetch(`https://room.internal/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, code }) });
      return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) } });
    }
    if (url.pathname === '/ws') {
      const code = String(url.searchParams.get('code') || '').toUpperCase();
      if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(code)) return new Response('Invalid room code', { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }
    return json({ message: 'Not found' }, 404);
  }
};

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    this.storage = ctx.storage;
  }
  async readRoom() { return await this.storage.get('room'); }
  async writeRoom(room) { await this.storage.put('room', room); }
  async replyError(message, status = 400) { return json({ message }, status); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/create-room' || url.pathname === '/join-room') {
      let body; try { body = await request.json(); } catch { return this.replyError('入力を読み取れません。'); }
      if (!validName(body.name)) return this.replyError('名前を1〜20文字で入力してください。');
      let room = await this.readRoom();
      if (url.pathname === '/create-room') {
        if (room) return this.replyError('その部屋コードは使用中です。もう一度作成してください。', 409);
        room = { code: body.code, players: [], state: { courts: 2, round: 0, matches: [] }, createdAt: Date.now() };
      } else if (!room) return this.replyError('部屋が見つかりません。コードを確認してください。', 404);
      const existing = room.players.find((player) => player.name.toLocaleLowerCase() === body.name.trim().toLocaleLowerCase());
      const sockets = this.ctx.getWebSockets();
      if (existing && sockets.some((ws) => ws.deserializeAttachment()?.playerId === existing.id)) return this.replyError('同じ名前がすでに参加しています。別の名前を入力してください.', 409);
      const player = existing || { id: crypto.randomUUID(), name: body.name.trim() };
      if (!existing) room.players.push(player);
      await this.writeRoom(room);
      await this.storage.setAlarm(room.createdAt + ROOM_TTL_MS);
      if (existing) this.broadcast(room);
      return json({ code: room.code, playerId: player.id, players: room.players, state: room.state });
    }
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const room = await this.readRoom();
      const playerId = url.searchParams.get('playerId');
      if (!room || !room.players.some((player) => player.id === playerId)) return new Response('Room or participant not found', { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.serializeAttachment({ playerId });
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'room', code: room.code, playerId, players: room.players, state: room.state }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }
  async webSocketMessage(ws, raw) {
    let message; try { message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const room = await this.readRoom(); if (!room) return;
    if (message.type === 'heartbeat') return;
    if (message.type === 'state-update' && message.state && typeof message.state === 'object') {
      const courts = Number(message.state.courts), round = Number(message.state.round);
      if (![1,2,3,4].includes(courts) || !Number.isInteger(round) || round < 0 || !Array.isArray(message.state.matches)) return;
      room.state = { courts, round, matches: message.state.matches.slice(0, 300) };
      await this.writeRoom(room); this.broadcast(room); return;
    }
    if (message.type === 'remove-player' && typeof message.playerId === 'string') {
      room.players = room.players.filter((player) => player.id !== message.playerId);
      room.state = { ...room.state, round: 0, matches: [] };
      await this.writeRoom(room); this.broadcast(room); return;
    }
    if (message.type === 'clear-players') {
      room.players = []; room.state = { ...room.state, round: 0, matches: [] };
      await this.writeRoom(room); this.broadcast(room);
    }
  }
  broadcast(room) {
    const payload = JSON.stringify({ type: 'room-update', code: room.code, players: room.players, state: room.state });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(payload); } catch {} }
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, '部屋の有効期限が終了しました'); } catch {} }
    await this.storage.deleteAll();
    await this.storage.deleteAlarm();
  }
}

