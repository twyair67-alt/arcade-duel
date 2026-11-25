"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(__dirname, "..");
const RECORDS_FILE = path.join(__dirname, "leaderboard.json");
const ROUND_SECONDS = 75;
const MAX_AMMO = 5;
const TRAIL_LENGTH = 6;
const TICK_INTERVAL_MS = 1000 / 30;
const SNAPSHOT_INTERVAL_MS = 1000 / 25;
const rooms = new Map();
const waitingRooms = [];
let records = readRecords();

function readRecords() {
  if (!fs.existsSync(RECORDS_FILE)) {
    fs.writeFileSync(RECORDS_FILE, "{}\n", "utf8");
    return {};
  }
  const saved = JSON.parse(fs.readFileSync(RECORDS_FILE, "utf8"));
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    throw new Error(`${RECORDS_FILE} must contain a JSON object`);
  }
  const normalized = {};
  Object.entries(saved).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const nickname = sanitizeNickname(value.nickname || key);
    normalized[nickname] = {
      nickname,
      wins: Math.max(0, Math.floor(Number(value.wins) || 0)),
      losses: Math.max(0, Math.floor(Number(value.losses) || 0)),
      draws: Math.max(0, Math.floor(Number(value.draws) || 0))
    };
  });
  return normalized;
}

function persistRecords() {
  try {
    const temporaryFile = `${RECORDS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryFile, RECORDS_FILE);
  } catch (error) {
    console.error("Could not save leaderboard records:", error);
  }
}

function send(socket, value) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function sanitizeNickname(value) {
  return String(value || "AAA").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "A");
}

function makePlayer(side, nickname) {
  return {
    side, name: nickname, x: side === 0 ? 50 : 950, y: 300, aim: side === 0 ? 0 : Math.PI,
    speed: 82, direction: side === 0 ? 1 : -1, ammo: 3, dodgeUntil: 0,
    cooldownUntil: 0, dodgeCount: 0, successfulDodges: 0, recoil: 0
  };
}

function makeState(names) {
  return {
    width: 1000, height: 600,
    players: [makePlayer(0, names[0]), makePlayer(1, names[1])],
    bullets: [], pickup: null, round: 1, totalRounds: 3, seconds: ROUND_SECONDS,
    roundWins: [0, 0], roundDraws: 0, elapsed: 0, phase: "playing", result: null
  };
}

function roomState(room) { return room.state; }
function broadcast(room, message) { room.players.forEach(socket => send(socket, message)); }
function broadcastState(room) {
  room.lastBroadcast = Date.now();
  broadcast(room, { type: "state", state: room.state });
}

function join(socket, nickname) {
  let room = waitingRooms.find(candidate => !candidate.closed && candidate.players.length === 1);
  if (!room) {
    room = { id: randomUUID(), players: [], names: [], state: null, lastTick: Date.now(), lastBroadcast: 0, closed: false, transition: null, recorded: false };
    rooms.set(room.id, room);
    waitingRooms.push(room);
  }
  const seat = room.players.length;
  socket.roomId = room.id;
  socket.seat = seat;
  room.players.push(socket);
  room.names.push(sanitizeNickname(nickname));
  if (room.players.length === 1) {
    send(socket, { type: "waiting", roomId: room.id, seat });
    return;
  }
  room.state = makeState(room.names);
  room.lastTick = Date.now();
  room.lastBroadcast = room.lastTick;
  const queueIndex = waitingRooms.indexOf(room);
  if (queueIndex >= 0) waitingRooms.splice(queueIndex, 1);
  room.players.forEach((player, index) => send(player, {
    type: "match_started", roomId: room.id, seat: index, names: room.names, state: roomState(room)
  }));
}

function validRoom(socket) {
  const room = rooms.get(socket.roomId);
  return room && !room.closed ? room : null;
}

function clampAim(side, angle) {
  if (!Number.isFinite(angle)) return side === 0 ? 0 : Math.PI;
  const center = side === 0 ? 0 : Math.PI;
  let delta = Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
  delta = Math.max(-1.05, Math.min(1.05, delta));
  return center + delta;
}

function handleAction(socket, message) {
  const room = validRoom(socket);
  if (!room || !room.state || room.state.phase !== "playing") return;
  const player = room.state.players[socket.seat];
  let broadcastImmediately = false;
  if (message.action === "aim") player.aim = clampAim(socket.seat, Number(message.angle));
  if (message.action === "fire" && player.ammo > 0) {
    player.ammo--;
    player.recoil = 1;
    const velocity = 430;
    const trail = Array.from({ length: TRAIL_LENGTH }, () => ({ x: 0, y: 0 }));
    room.state.bullets.push({
      x: player.x + Math.cos(player.aim) * 24, y: player.y + Math.sin(player.aim) * 24,
      vx: Math.cos(player.aim) * velocity, vy: Math.sin(player.aim) * velocity,
      owner: socket.seat, trail, trailIndex: 0, trailCount: 0
    });
    broadcastImmediately = true;
  }
  if (message.action === "dodge") {
    const now = Date.now() / 1000;
    if (now >= player.cooldownUntil) {
      player.dodgeUntil = now + 0.4;
      player.cooldownUntil = now + 10.4;
      player.dodgeCount++;
      broadcastImmediately = true;
    }
  }
  if (broadcastImmediately) broadcastState(room);
}

function createPickup(state) {
  return {
    x: 250 + Math.random() * 500, y: 120 + Math.random() * 360,
    vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70
  };
}

function addRecord(nickname, result) {
  const record = records[nickname] || (records[nickname] = { nickname, wins: 0, losses: 0, draws: 0 });
  if (result === "win") record.wins++;
  else if (result === "loss") record.losses++;
  else record.draws++;
}

function finishMatch(room, winner) {
  if (room.closed || room.recorded) return;
  room.recorded = true;
  const result = winner === null ? "draw" : "win";
  room.names.forEach((name, seat) => addRecord(name, winner === null ? "draw" : seat === winner ? "win" : "loss"));
  persistRecords();
  room.state.phase = "matchEnd";
  room.state.result = result;
  room.players.forEach((socket, seat) => send(socket, {
    type: "match_end", result: winner === null ? "draw" : seat === winner ? "win" : "loss", state: room.state
  }));
  room.transition = setTimeout(() => closeRoom(room), 12000);
}

function resetRound(room) {
  const s = room.state;
  const names = s.players.map(player => player.name);
  s.players = [makePlayer(0, names[0]), makePlayer(1, names[1])];
  s.bullets = []; s.pickup = null; s.seconds = ROUND_SECONDS; s.elapsed = 0; s.phase = "playing";
}

function startNextRound(room) {
  if (room.closed) return;
  const s = room.state;
  if (s.round >= 3 && s.roundWins[0] !== s.roundWins[1]) {
    finishMatch(room, s.roundWins[0] > s.roundWins[1] ? 0 : 1);
    return;
  }
  if (s.round === 3 && s.roundWins[0] === s.roundWins[1]) s.totalRounds = 4;
  if (s.round === 4) {
    finishMatch(room, s.roundWins[0] === s.roundWins[1] ? null : s.roundWins[0] > s.roundWins[1] ? 0 : 1);
    return;
  }
  s.round++;
  resetRound(room);
  room.lastTick = Date.now();
  broadcastState(room);
}

function finishRound(room, winner) {
  const s = room.state;
  if (s.phase !== "playing") return;
  if (winner === 0 || winner === 1) s.roundWins[winner]++;
  else s.roundDraws++;
  s.phase = "roundEnd";
  room.lastBroadcast = Date.now();
  broadcast(room, { type: "round_end", winner, state: s });
  room.transition = setTimeout(() => startNextRound(room), 2600);
}

function tick(room, nowMs) {
  if (room.closed || !room.state || room.state.phase !== "playing") return;
  const s = room.state;
  const dt = Math.max(0, Math.min((nowMs - room.lastTick) / 1000, 0.05));
  room.lastTick = nowMs;
  const now = nowMs / 1000;
  s.elapsed += dt;
  s.seconds = Math.max(0, ROUND_SECONDS - s.elapsed);
  for (let playerIndex = 0; playerIndex < s.players.length; playerIndex++) {
    const player = s.players[playerIndex];
    if (now < player.dodgeUntil) continue;
    player.y += player.direction * player.speed * (1 + s.elapsed * 0.018) * dt;
    if (player.y < 26) { player.y = 26; player.direction = 1; }
    if (player.y > s.height - 26) { player.y = s.height - 26; player.direction = -1; }
    player.speed = Math.min(260, player.speed + dt * 1.25);
    player.recoil = Math.max(0, player.recoil - dt * 5);
  }
  for (let index = s.bullets.length - 1; index >= 0; index--) {
    const bullet = s.bullets[index];
    const trailPoint = bullet.trail[bullet.trailIndex];
    trailPoint.x = bullet.x;
    trailPoint.y = bullet.y;
    bullet.trailIndex = (bullet.trailIndex + 1) % TRAIL_LENGTH;
    bullet.trailCount = Math.min(TRAIL_LENGTH, bullet.trailCount + 1);
    bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt;
    const target = s.players[1 - bullet.owner];
    if (Math.hypot(target.x - bullet.x, target.y - bullet.y) < 17) {
      s.bullets.splice(index, 1);
      if (now < target.dodgeUntil) {
        target.successfulDodges++;
        if (target.ammo === 0 && target.successfulDodges % 3 === 0) target.ammo = Math.min(MAX_AMMO, target.ammo + 2);
        continue;
      }
      finishRound(room, bullet.owner);
      break;
    }
    if (bullet.x < -20 || bullet.x > s.width + 20 || bullet.y < -20 || bullet.y > s.height + 20) s.bullets.splice(index, 1);
  }
  if (s.phase !== "playing") return;
  if (s.players.every(player => player.ammo === 0) && !s.pickup) s.pickup = createPickup(s);
  if (s.pickup) {
    const p = s.pickup;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < 12 || p.x > s.width - 12) p.vx *= -1;
    if (p.y < 12 || p.y > s.height - 12) p.vy *= -1;
    for (const player of s.players) {
      if (player.ammo < MAX_AMMO && Math.hypot(player.x - p.x, player.y - p.y) < 28) {
        player.ammo++; s.pickup = null; break;
      }
    }
  }
  if (s.seconds <= 0) finishRound(room, null);
}

function leave(socket) {
  const room = validRoom(socket);
  if (!room) return;
  room.closed = true;
  if (room.transition) clearTimeout(room.transition);
  const index = waitingRooms.indexOf(room);
  if (index >= 0) waitingRooms.splice(index, 1);
  room.players.forEach(player => {
    if (player !== socket) send(player, { type: "error", message: "L'avversario ha abbandonato la partita." });
    player.roomId = null;
  });
  rooms.delete(room.id);
}

function closeRoom(room) {
  if (room.closed) return;
  room.closed = true;
  if (room.transition) clearTimeout(room.transition);
  rooms.delete(room.id);
  room.players.forEach(player => { player.roomId = null; });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/leaderboard") {
    const sorted = Object.values(records).sort((a, b) => (b.wins * 3 + b.draws) - (a.wins * 3 + a.draws) || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    response.end(JSON.stringify({ records: sorted }));
    return;
  }
  let requested;
  try { requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname); }
  catch (error) { response.writeHead(400); response.end("Bad request"); return; }
  const file = path.resolve(ROOT, `.${requested}`);
  if (!file.startsWith(`${ROOT}${path.sep}`) && file !== ROOT) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500); response.end("Not found"); return; }
    response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(file)] || "application/octet-stream" });
    response.end(content);
  });
});

const wss = new WebSocketServer({ server });
wss.on("connection", socket => {
  socket.on("message", data => {
    let message;
    try { message = JSON.parse(data.toString()); }
    catch (error) {
      console.error("Invalid WebSocket JSON:", data.toString().slice(0, 200));
      send(socket, { type: "error", message: "Messaggio JSON non valido." });
      return;
    }
    if (message.type === "join" && !socket.roomId) join(socket, message.nickname);
    else if (message.type === "action") handleAction(socket, message);
    else if (message.type === "leave") leave(socket);
  });
  socket.on("close", () => leave(socket));
  socket.on("error", error => console.error("WebSocket client error:", error.message));
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => {
    if (!room.state || room.state.phase === "matchEnd") return;
    tick(room, now);
    if (room.state.phase === "playing" && now - room.lastBroadcast >= SNAPSHOT_INTERVAL_MS) broadcastState(room);
  });
}, TICK_INTERVAL_MS);

server.listen(PORT, () => console.log(`ARCADE DUEL server listening on port ${PORT}`));
