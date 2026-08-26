const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const rooms = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  response.end(JSON.stringify(body));
}
function roomCode() {
  let code;
  do code = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(code));
  return code;
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => { data += chunk; if (data.length > 1_000_000) request.destroy(); });
    request.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } });
  });
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    const code = roomCode();
    rooms.set(code, { state:null, updatedAt:Date.now() });
    return json(response, 201, { code });
  }
  const claimMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/claim$/);
  if (claimMatch && request.method === 'POST') {
    const room = rooms.get(claimMatch[1]);
    if (!room?.state?.state?.roomLobby) return json(response, 404, { error:'대기실을 찾을 수 없습니다.' });
    try {
      const payload = await readBody(request);
      const lobby = room.state.state.roomLobby;
      const claims = lobby.claims;
      if (!Array.isArray(lobby.bench)) lobby.bench = [];
      const leaveEverything = () => {
        for (const key of Object.keys(claims)) if (claims[key]?.clientId === payload.clientId) claims[key] = null;
        lobby.bench = lobby.bench.filter((person) => person.clientId !== payload.clientId);
      };
      if (payload.slot === 'bench') {
        leaveEverything();
        lobby.bench.push({ clientId:payload.clientId, name:payload.name });
      } else {
        if (!Object.prototype.hasOwnProperty.call(claims, payload.slot)) return json(response, 400, { error:'없는 자리입니다.' });
        const current = claims[payload.slot];
        if (current && current.clientId !== payload.clientId) return json(response, 409, { error:'이미 다른 플레이어가 참가한 자리입니다.' });
        leaveEverything();
        claims[payload.slot] = { clientId:payload.clientId, name:payload.name };
      }
      room.updatedAt = Date.now();
      return json(response, 200, { state:room.state, updatedAt:room.updatedAt });
    } catch { return json(response, 400, { error:'잘못된 참가 요청입니다.' }); }
  }
  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)$/);
  if (roomMatch) {
    const room = rooms.get(roomMatch[1]);
    if (!room) return json(response, 404, { error:'방을 찾을 수 없습니다.' });
    if (request.method === 'GET') return json(response, 200, room);
    if (request.method === 'POST') {
      try {
        const payload = await readBody(request);
        room.state = payload.state;
        room.updatedAt = Date.now();
        return json(response, 200, { updatedAt:room.updatedAt });
      } catch { return json(response, 400, { error:'잘못된 게임 데이터입니다.' }); }
    }
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filename = path.resolve(root, `.${requested}`);
  if (!filename.startsWith(root)) return response.end('Forbidden');
  fs.readFile(filename, (error, data) => {
    if (error) { response.writeHead(404); return response.end('Not found'); }
    response.writeHead(200, { 'Content-Type':mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    response.end(data);
  });
}).listen(process.env.PORT || 4173, '0.0.0.0', () => console.log('Hell Commute server listening on port 4173'));
