"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { createPersistentStore } = require("./persistence.js");

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = process.env.ARCADE_DATA_FILE || path.join(__dirname, "game-data.json");
const LEGACY_FILES = [
  path.join(__dirname, "leaderboard.json"),
  path.join(__dirname, "data", "leaderboard.json"),
  path.join(__dirname, "cpu-leaderboard.json")
];
const ROUND_SECONDS = 120;
const MAX_AMMO = 5;
const TRAIL_LENGTH = 6;
const TICK_INTERVAL_MS = 1000 / 30;
const SNAPSHOT_INTERVAL_MS = 1000 / 25;
const rooms = new Map();
const waitingRooms = [];
const store = createPersistentStore(DATA_FILE, LEGACY_FILES);
const data = store.data;
const privateLobbies = new Map();
const rankedWaiting = [];
const DAILY_CHALLENGES = [
  { id: "shots", title: "Spara 20 colpi", target: 20, cosmetic: "scia-cyan" },
  { id: "reloads", title: "Ricarica 5 volte", target: 5, cosmetic: "scia-pink" },
  { id: "wins", title: "Vinci una partita online", target: 1, cosmetic: "scia-gold" }
];

function send(socket, value) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function sanitizeNickname(value) {
  return String(value || "AAA").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "A");
}

function getDivision(rankXp) {
  const divisions = [
    { id: "wood", name: "Legno", xp: 0 },
    { id: "bronze", name: "Bronzo", xp: 100 },
    { id: "silver", name: "Argento", xp: 300 },
    { id: "gold", name: "Oro", xp: 600 },
    { id: "platinum", name: "Platino", xp: 1000 },
    { id: "ace", name: "Asso", xp: 1500 }
  ];
  let current = divisions[0], next = null;
  for (let index = 0; index < divisions.length; index++) {
    if (rankXp >= divisions[index].xp) current = divisions[index];
    else { next = divisions[index]; break; }
  }
  return { ...current, next, progress: next ? (rankXp - current.xp) / (next.xp - current.xp) : 1 };
}

function ensureDailyChallenges(profile) {
  const today = new Date().toISOString().slice(0, 10);
  if (profile.challenges?.date === today) return profile.challenges;
  profile.challenges = {
    date: today,
    items: Object.fromEntries(DAILY_CHALLENGES.map(challenge => [challenge.id, { progress: 0, target: challenge.target, complete: false }])),
    cosmetics: profile.challenges?.cosmetics || []
  };
  return profile.challenges;
}

function ensureProfile(profileId, nickname) {
  const requestedId = typeof profileId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)
    ? profileId.toLowerCase() : null;
  const existing = requestedId ? data.profiles[requestedId] : null;
  const id = requestedId && !existing ? requestedId : randomUUID();
  const profile = {
    id, accessToken: randomUUID(), nickname: sanitizeNickname(nickname), rankXp: 0, tournamentXp: 0,
    stats: { wins: 0, losses: 0, draws: 0, shots: 0, hits: 0, damage: 0, reloads: 0 },
    challenges: null, createdAt: new Date().toISOString()
  };
  data.profiles[id] = profile;
  ensureDailyChallenges(profile);
  schedulePersist();
  return profile;
}

function authenticateProfile(profileId, accessToken, nickname) {
  const id = typeof profileId === "string" ? profileId.toLowerCase() : "";
  const profile = data.profiles[id];
  if (profile && typeof accessToken === "string" && accessToken === profile.accessToken) {
    profile.nickname = sanitizeNickname(nickname || profile.nickname);
    profile.rankXp = Math.max(0, Math.floor(Number(profile.rankXp) || 0));
    profile.tournamentXp = Math.max(0, Math.floor(Number(profile.tournamentXp) || 0));
    profile.stats ||= { wins: 0, losses: 0, draws: 0, shots: 0, hits: 0, damage: 0, reloads: 0 };
    ensureDailyChallenges(profile);
    return profile;
  }
  return ensureProfile(profileId, nickname);
}

function profileView(profile, includeToken = false) {
  return {
    id: profile.id, nickname: profile.nickname, rankXp: profile.rankXp,
    tournamentXp: profile.tournamentXp || 0,
    division: getDivision(profile.rankXp), stats: profile.stats,
    challenges: ensureDailyChallenges(profile),
    ...(includeToken ? { accessToken: profile.accessToken } : {})
  };
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    store.save();
  }, 250);
}

function updateChallenge(profile, id, amount = 1) {
  const challenges = ensureDailyChallenges(profile);
  const challenge = challenges.items[id];
  if (!challenge || challenge.complete) return;
  challenge.progress = Math.min(challenge.target, challenge.progress + amount);
  if (challenge.progress >= challenge.target) {
    challenge.complete = true;
    const cosmetic = DAILY_CHALLENGES.find(item => item.id === id)?.cosmetic;
    if (cosmetic && !challenges.cosmetics.includes(cosmetic)) challenges.cosmetics.push(cosmetic);
  }
  schedulePersist();
}

function updateCpuRecord(profile, difficulty, result) {
  const xpByDifficulty = { easy: 15, medium: 30, hard: 55 };
  const bucket = data.cpuRecords[difficulty];
  const record = bucket[profile.id] || (bucket[profile.id] = {
    profileId: profile.id, nickname: profile.nickname, difficulty, xp: 0, wins: 0, losses: 0, draws: 0
  });
  record.nickname = profile.nickname;
  if (result === "win") { record.wins++; record.xp += xpByDifficulty[difficulty]; }
  else if (result === "loss") record.losses++;
  else record.draws++;
  schedulePersist();
}

const SHIPS = {
  viper: { speed: 4, fire: 5, shield: 3, cooldown: 18 },
  aegis: { speed: 2, fire: 3, shield: 7, cooldown: 20 },
  phantom: { speed: 6, fire: 4, shield: 2, cooldown: 14 },
  nova: { speed: 4, fire: 4, shield: 4, cooldown: 18 },
  titan: { speed: 3, fire: 4, shield: 5, cooldown: 16 }
};

function makePlayer(side, nickname, shipId = "viper") {
  const selectedShip = SHIPS[shipId] ? shipId : "viper";
  const ship = SHIPS[selectedShip];
  return {
    side, name: nickname, x: side === 0 ? 50 : 950, y: 300, aim: side === 0 ? 0 : Math.PI,
    shipId: selectedShip, speed: 30 + ship.speed * 13, fireStat: ship.fire, maxShield: ship.shield, shield: ship.shield,
    direction: side === 0 ? 1 : -1, ammo: MAX_AMMO, reloadReadyAt: 0, lastReloadAt: -10, slowUntil: 0,
    fireReadyAt: 0, cooldownUntil: 0, dodgeUntil: 0, dodgeCount: 0, successfulDodges: 0, recoil: 0,
    abilityReadyAt: 0, burstShots: 0, burstNextAt: 0, reflectUntil: 0, dashUntil: 0,
    dashX: 0, dashY: 0, empUntil: 0, piercingShot: false
  };
}

function makeState(names, shipIds, profileIds, mode) {
  return {
    width: 1000, height: 600,
    obstacles: [
      { x: 440, y: 132, baseY: 132, width: 120, height: 60, angle: 0, phase: 0 },
      { x: 440, y: 408, baseY: 408, width: 120, height: 60, angle: 0, phase: Math.PI }
    ],
    players: [makePlayer(0, names[0], shipIds[0]), makePlayer(1, names[1], shipIds[1])],
    bullets: [], pickup: null, round: 1, totalRounds: 3, seconds: ROUND_SECONDS,
    roundWins: [0, 0], roundDraws: 0, elapsed: 0, matchElapsed: 0,
    mode, profileIds, matchStats: profileIds.map(() => ({ shots: 0, hits: 0, damage: 0, reloads: 0 })),
    suddenDeath: { active: false, inset: 0, elapsed: 0 },
    phase: "playing", result: null
  };
}

function roomState(room) { return room.state; }
function broadcast(room, message) { room.players.forEach(socket => send(socket, message)); }
function broadcastState(room) {
  room.lastBroadcast = Date.now();
  broadcast(room, { type: "state", state: room.state });
}

function startMatch(sockets, mode, options = {}) {
  const players = sockets.slice(0, 2);
  const room = {
    id: randomUUID(), players, names: players.map(socket => socket.profile.nickname),
    profileIds: players.map(socket => socket.profileId), shipIds: players.map(socket => socket.shipId),
    mode, tournament: options.tournament || null, closed: false, recorded: false,
    lastTick: Date.now(), lastBroadcast: Date.now(), transition: null, disconnectForfeit: false
  };
  room.state = makeState(room.names, room.shipIds, room.profileIds, mode);
  rooms.set(room.id, room);
  players.forEach((socket, index) => {
    socket.roomId = room.id;
    socket.seat = index;
    socket.lobbyId = null;
    send(socket, {
      type: "match_started", roomId: room.id, seat: index, names: room.names,
      mode, ranked: mode === "ranked", inviteCode: options.inviteCode || null, state: room.state
    });
  });
  return room;
}

function rankedTolerance(waitMs) {
  return Math.min(1500, 75 + Math.floor(waitMs / 1000) * 25);
}

function queueRanked(socket) {
  socket.queueMode = "ranked";
  socket.waitingSince = Date.now();
  rankedWaiting.push(socket);
  send(socket, { type: "waiting", mode: "ranked", rankXp: socket.profile.rankXp, division: getDivision(socket.profile.rankXp) });
  tryPairRanked();
}

function tryPairRanked() {
  const now = Date.now();
  for (let index = rankedWaiting.length - 1; index >= 0; index--) {
    const socket = rankedWaiting[index];
    if (socket.readyState !== WebSocket.OPEN || socket.queueMode !== "ranked") rankedWaiting.splice(index, 1);
  }
  for (let left = 0; left < rankedWaiting.length; left++) {
    const first = rankedWaiting[left];
    let bestIndex = -1, bestDifference = Infinity;
    for (let right = left + 1; right < rankedWaiting.length; right++) {
      const second = rankedWaiting[right];
      const difference = Math.abs(first.profile.rankXp - second.profile.rankXp);
      const tolerance = Math.max(rankedTolerance(now - first.waitingSince), rankedTolerance(now - second.waitingSince));
      if (difference <= tolerance && difference < bestDifference) { bestIndex = right; bestDifference = difference; }
    }
    if (bestIndex < 0) continue;
    const pair = [first, rankedWaiting[bestIndex]];
    rankedWaiting.splice(bestIndex, 1);
    rankedWaiting.splice(left, 1);
    pair.forEach(socket => { socket.queueMode = null; });
    startMatch(pair, "ranked");
    tryPairRanked();
    return;
  }
}

function queueFriendly(socket) {
  socket.queueMode = "friendly";
  const index = waitingRooms.findIndex(candidate => candidate.readyState === WebSocket.OPEN);
  if (index < 0) {
    waitingRooms.push(socket);
    send(socket, { type: "waiting", mode: "friendly" });
    return;
  }
  const opponent = waitingRooms.splice(index, 1)[0];
  opponent.queueMode = null;
  socket.queueMode = null;
  startMatch([opponent, socket], "friendly");
}

function createInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (privateLobbies.has(code));
  return code;
}

function lobbyView(lobby) {
  return {
    code: lobby.code, kind: lobby.kind, hostId: lobby.hostId,
    players: lobby.players.filter(player => player.socket?.readyState === WebSocket.OPEN).map(player => ({
      profileId: player.profile.id, nickname: player.profile.nickname, isHost: player.profile.id === lobby.hostId
    })),
    canStart: lobby.kind === "tournament" && lobby.players.filter(player => !player.disconnected).length >= 4
  };
}

function broadcastLobby(lobby) {
  const view = lobbyView(lobby);
  lobby.players.forEach(player => send(player.socket, { type: "private_lobby", lobby: view }));
}

function createPrivateLobby(socket, kind) {
  if (kind !== "friendly" && kind !== "tournament") return send(socket, { type: "error", message: "Tipo lobby non valido." });
  const code = createInviteCode();
  const lobby = {
    code, kind, hostId: socket.profileId,
    players: [{ profile: socket.profile, socket, seed: 0, disconnected: false }]
  };
  privateLobbies.set(code, lobby);
  socket.lobbyId = code;
  send(socket, { type: "private_lobby", lobby: lobbyView(lobby) });
}

function joinPrivateLobby(socket, code, kind) {
  const lobby = privateLobbies.get(String(code || "").toUpperCase());
  const invalidMessage = kind === "tournament" ? "Codice torneo non valido." : "Codice invito non valido o lobby già avviata.";
  if (!lobby || lobby.kind !== kind || lobby.started) return send(socket, { type: "error", message: invalidMessage });
  if (lobby.players.some(player => player.profile.id === socket.profileId && !player.disconnected)) {
    return send(socket, { type: "error", message: "Sei già nella lobby." });
  }
  if (lobby.players.length >= 16) return send(socket, { type: "error", message: "La lobby ha raggiunto il limite di 16 giocatori." });
  const participant = { profile: socket.profile, socket, seed: lobby.players.length, disconnected: false };
  lobby.players.push(participant);
  socket.lobbyId = lobby.code;
  if (lobby.kind === "friendly" && lobby.players.length >= 2) {
    privateLobbies.delete(lobby.code);
    lobby.started = true;
    startMatch(lobby.players.slice(0, 2).map(player => player.socket), "friendly", { inviteCode: lobby.code });
    return;
  }
  broadcastLobby(lobby);
}

function createFriendlyRoom(socket) { createPrivateLobby(socket, "friendly"); }

function createTournament(socket) { createPrivateLobby(socket, "tournament"); }

function joinTournament(socket, code) {
  joinPrivateLobby(socket, code, "tournament");
}

function startTournament(socket, code) {
  const lobby = privateLobbies.get(String(code || "").toUpperCase());
  if (!lobby || lobby.kind !== "tournament" || lobby.hostId !== socket.profileId) {
    return send(socket, { type: "error", message: "Solo l'host può avviare questo torneo." });
  }
  const connected = lobby.players.filter(player => !player.disconnected && player.socket?.readyState === WebSocket.OPEN);
  if (connected.length < 4) return send(socket, { type: "error", message: "Servono almeno 4 giocatori per avviare il torneo." });
  lobby.started = true;
  privateLobbies.delete(lobby.code);
  const tournament = {
    id: randomUUID(), code: lobby.code, players: connected, roundPlayers: connected.slice(),
    roundIndex: 0, pairs: [], pairIndex: 0, nextRound: [], eliminated: [], activeRoom: null
  };
  connected.forEach((player, index) => { player.seed = index; player.socket.tournamentId = tournament.id; });
  tournaments.set(tournament.id, tournament);
  prepareTournamentRound(tournament);
}

const tournaments = new Map();

function prepareTournamentRound(tournament) {
  if (tournament.roundPlayers.length <= 1) return completeTournament(tournament);
  tournament.pairs = [];
  tournament.nextRound = [];
  tournament.pairIndex = 0;
  for (let index = 0; index < tournament.roundPlayers.length; index += 2) {
    const first = tournament.roundPlayers[index];
    const second = tournament.roundPlayers[index + 1];
    if (second) tournament.pairs.push([first, second]);
    else if (!first.disconnected) tournament.nextRound.push(first);
    else tournament.eliminated.push({ player: first, round: tournament.roundIndex, shieldRatio: 0 });
  }
  tournament.roundIndex++;
  advanceTournament(tournament);
}

function advanceTournament(tournament) {
  if (!tournament || tournament.activeRoom) return;
  if (tournament.pairIndex >= tournament.pairs.length) {
    tournament.roundPlayers = tournament.nextRound;
    if (tournament.roundPlayers.length <= 1) completeTournament(tournament);
    else prepareTournamentRound(tournament);
    return;
  }
  const [first, second] = tournament.pairs[tournament.pairIndex];
  const firstConnected = !first.disconnected && first.socket?.readyState === WebSocket.OPEN;
  const secondConnected = !second.disconnected && second.socket?.readyState === WebSocket.OPEN;
  if (!firstConnected && !secondConnected) {
    tournament.eliminated.push({ player: first, round: tournament.roundIndex, shieldRatio: 0 });
    tournament.eliminated.push({ player: second, round: tournament.roundIndex, shieldRatio: 0 });
    tournament.pairIndex++;
    return advanceTournament(tournament);
  }
  if (!firstConnected || !secondConnected) {
    const winner = firstConnected ? first : second;
    const loser = firstConnected ? second : first;
    tournament.nextRound.push(winner);
    tournament.eliminated.push({ player: loser, round: tournament.roundIndex, shieldRatio: 0 });
    tournament.pairIndex++;
    return advanceTournament(tournament);
  }
  const room = startMatch([first.socket, second.socket], "tournament", { tournament });
  tournament.activeRoom = room;
  tournament.players.forEach(player => send(player.socket, {
    type: "tournament_progress",
    code: tournament.code,
    round: tournament.roundIndex,
    match: tournament.pairIndex + 1,
    totalMatches: tournament.pairs.length
  }));
}

function completeTournament(tournament) {
  if (!tournament || tournament.completed) return;
  tournament.completed = true;
  const champion = tournament.roundPlayers[0] || null;
  const ordered = tournament.eliminated.slice().sort((a, b) =>
    b.round - a.round || b.shieldRatio - a.shieldRatio || a.player.seed - b.player.seed
  );
  const standings = champion ? [champion, ...ordered.map(entry => entry.player)] : ordered.map(entry => entry.player);
  const count = standings.length;
  const results = standings.map((player, index) => {
    const rewardSteps = [100, 60, 30, 10];
    const position = count <= 1 ? 0 : (index / (count - 1)) * (rewardSteps.length - 1);
    const step = Math.min(rewardSteps.length - 2, Math.floor(position));
    const fraction = position - step;
    const xp = count <= 1 ? 100 : Math.round(rewardSteps[step] + (rewardSteps[step + 1] - rewardSteps[step]) * fraction);
    player.profile.tournamentXp = (player.profile.tournamentXp || 0) + xp;
    schedulePersist();
    return { profileId: player.profile.id, nickname: player.profile.nickname, place: index + 1, xp };
  });
  tournament.players.forEach(player => send(player.socket, { type: "tournament_complete", code: tournament.code, standings: results }));
  tournaments.delete(tournament.id);
}

function endTournamentMatch(room, winner) {
  const tournament = room.tournament;
  if (!tournament) return;
  const loserSide = winner === 0 ? 1 : 0;
  const loser = tournament.pairs[tournament.pairIndex][loserSide];
  const winnerPlayer = tournament.pairs[tournament.pairIndex][winner];
  const loserSeat = room.state.players[loserSide];
  const shieldRatio = loserSeat.maxShield ? loserSeat.shield / loserSeat.maxShield : 0;
  tournament.nextRound.push(winnerPlayer);
  tournament.eliminated.push({ player: loser, round: tournament.roundIndex, shieldRatio });
  tournament.activeRoom = null;
  tournament.pairIndex++;
  closeRoom(room);
  setTimeout(() => advanceTournament(tournament), 1800);
}

function removeFromPrivateLobby(socket) {
  const lobby = privateLobbies.get(socket.lobbyId);
  if (!lobby) { socket.lobbyId = null; return; }
  lobby.players = lobby.players.filter(player => player.socket !== socket);
  socket.lobbyId = null;
  if (lobby.players.length === 0) privateLobbies.delete(lobby.code);
  else {
    if (lobby.hostId === socket.profileId) lobby.hostId = lobby.players[0].profile.id;
    broadcastLobby(lobby);
  }
}

function removeFromRankedQueue(socket) {
  const rankedIndex = rankedWaiting.indexOf(socket);
  if (rankedIndex >= 0) rankedWaiting.splice(rankedIndex, 1);
  const friendlyIndex = waitingRooms.indexOf(socket);
  if (friendlyIndex >= 0) waitingRooms.splice(friendlyIndex, 1);
  socket.queueMode = null;
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
  const now = Date.now() / 1000;
  let broadcastImmediately = false;
  if (message.action === "aim" && Number.isFinite(Number(message.angle))) {
    player.aim = clampAim(socket.seat, Number(message.angle));
  }
  if (message.action === "fire" && player.ammo > 0 && now >= player.fireReadyAt) {
    player.ammo--;
    player.fireReadyAt = now + Math.max(.22, .82 - player.fireStat * .09);
    player.recoil = 1;
    addBullet(room.state, player);
    room.state.matchStats[socket.seat].shots++;
    updateChallenge(socket.profile, "shots", 1);
    broadcastImmediately = true;
  }
  if (message.action === "dodge") {
    if (now >= player.cooldownUntil) {
      player.dodgeUntil = now + 0.4;
      player.cooldownUntil = now + 10.4;
      player.dodgeCount++;
      broadcastImmediately = true;
    }
  }
  if (message.action === "reload") {
    const elapsed = now - player.lastReloadAt;
    const sweetSpot = elapsed >= 4.5 && elapsed <= 5.5;
    if (player.ammo < MAX_AMMO && (now >= player.reloadReadyAt || sweetSpot)) {
      player.ammo = Math.min(MAX_AMMO, player.ammo + 2);
      player.lastReloadAt = now;
      player.reloadReadyAt = now + 10;
      player.slowUntil = now + (sweetSpot ? .25 : .5);
      room.state.matchStats[socket.seat].reloads++;
      updateChallenge(socket.profile, "reloads", 1);
      broadcastImmediately = true;
    }
  }
  if (message.action === "skill" && now >= player.abilityReadyAt) {
    const cooldown = SHIPS[player.shipId]?.cooldown || 18;
    if (player.shipId === "viper" && player.ammo <= 0) return;
    player.abilityReadyAt = now + cooldown;
    if (player.shipId === "viper") {
      player.ammo--; player.burstShots = 3; player.burstNextAt = now;
    } else if (player.shipId === "aegis") player.reflectUntil = now + 1.5;
    else if (player.shipId === "phantom") {
      player.dashX = Math.cos(player.aim); player.dashY = Math.sin(player.aim); player.dashUntil = now + .25;
    } else if (player.shipId === "nova") room.state.players[1 - socket.seat].empUntil = now + 1.5;
    else if (player.shipId === "titan") player.piercingShot = true;
    broadcastImmediately = true;
  }
  if (message.action === "emote" && ["gg", "nice", "oops", "rematch"].includes(message.emote)) {
    broadcast(room, { type: "emote", side: socket.seat, emote: message.emote });
  }
  if (broadcastImmediately) broadcastState(room);
}

function addBullet(state, player) {
  const velocity = 430;
  const trail = Array.from({ length: TRAIL_LENGTH }, () => ({ x: 0, y: 0 }));
  state.bullets.push({
    x: player.x + Math.cos(player.aim) * 24, y: player.y + Math.sin(player.aim) * 24,
    vx: Math.cos(player.aim) * velocity, vy: Math.sin(player.aim) * velocity,
    owner: player.side, piercing: player.piercingShot, trail, trailIndex: 0, trailCount: 0
  });
  player.piercingShot = false;
}

function createPickup(state) {
  return {
    x: 250 + Math.random() * 500, y: 120 + Math.random() * 360,
    vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70
  };
}

function resolveMatchWinner(state) {
  const first = state.players[0], second = state.players[1];
  const firstRatio = first.maxShield ? first.shield / first.maxShield : 0;
  const secondRatio = second.maxShield ? second.shield / second.maxShield : 0;
  if (firstRatio !== secondRatio) return firstRatio > secondRatio ? 0 : 1;
  if (first.ammo !== second.ammo) return first.ammo > second.ammo ? 0 : 1;
  const firstDamage = state.matchStats[0]?.damage || 0;
  const secondDamage = state.matchStats[1]?.damage || 0;
  if (firstDamage !== secondDamage) return firstDamage > secondDamage ? 0 : 1;
  return 0;
}

function finishMatch(room, winner) {
  if (room.closed || room.recorded) return;
  room.recorded = true;
  if (winner === null) winner = resolveMatchWinner(room.state);
  const profileResults = [];
  room.profileIds.forEach((profileId, seat) => {
    const profile = data.profiles[profileId];
    if (!profile) return;
    const result = seat === winner ? "win" : "loss";
    if (room.mode === "ranked") {
      const delta = result === "win" ? 30 : -20;
      profile.rankXp = Math.max(0, profile.rankXp + delta);
      profile.stats[result === "win" ? "wins" : "losses"]++;
      for (const key of ["shots", "hits", "damage", "reloads"]) {
        profile.stats[key] += room.state.matchStats[seat][key] || 0;
      }
      data.officialRecords[profileId] = {
        profileId, nickname: profile.nickname, wins: profile.stats.wins, losses: profile.stats.losses,
        draws: profile.stats.draws, rankXp: profile.rankXp
      };
      profileResults.push({ profileId, rankDelta: delta, rankXp: profile.rankXp, division: getDivision(profile.rankXp) });
      schedulePersist();
    }
    if (result === "win") updateChallenge(profile, "wins", 1);
  });
  room.state.matchWinner = winner;
  room.state.profileResults = profileResults;
  room.state.phase = "matchEnd";
  room.state.result = "win";
  room.players.forEach((socket, seat) => send(socket, {
    type: "match_end", result: seat === winner ? "win" : "loss", state: room.state,
    stats: room.state.matchStats[seat], profile: profileView(data.profiles[socket.profileId]),
    rankDelta: profileResults.find(result => result.profileId === socket.profileId)?.rankDelta || 0
  }));
  if (room.mode === "tournament" && room.tournament) {
    endTournamentMatch(room, winner);
    return;
  }
  room.transition = setTimeout(() => closeRoom(room), 12000);
}

function resetRound(room) {
  const s = room.state;
  const names = s.players.map(player => player.name);
  const shipIds = s.players.map(player => player.shipId);
  s.players = [makePlayer(0, names[0], shipIds[0]), makePlayer(1, names[1], shipIds[1])];
  s.obstacles = [
    { x: 440, y: 132, baseY: 132, width: 120, height: 60, angle: 0, phase: 0 },
    { x: 440, y: 408, baseY: 408, width: 120, height: 60, angle: 0, phase: Math.PI }
  ];
  s.bullets = []; s.pickup = null; s.seconds = ROUND_SECONDS; s.elapsed = 0;
  s.suddenDeath = { active: false, inset: 0, elapsed: 0 };
  s.phase = "playing";
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
  s.matchElapsed += dt;
  s.seconds = Math.max(0, ROUND_SECONDS - s.elapsed);
  const suddenElapsed = Math.max(0, s.elapsed - 90);
  s.suddenDeath = {
    active: s.elapsed >= 90,
    elapsed: suddenElapsed,
    inset: Math.min(180, suddenElapsed * 3)
  };
  for (const obstacle of s.obstacles) {
    obstacle.y = obstacle.baseY + Math.sin(s.elapsed * .75 + obstacle.phase) * 34;
    obstacle.angle = Math.sin(s.elapsed * .8 + obstacle.phase) * .28;
  }
  for (let playerIndex = 0; playerIndex < s.players.length; playerIndex++) {
    const player = s.players[playerIndex];
    const inset = s.suddenDeath.inset;
    if (now < player.dashUntil) {
      player.x += player.dashX * 440 * dt;
      player.y += player.dashY * 440 * dt;
    } else if (now >= player.dodgeUntil) {
      const reloadMultiplier = now < player.slowUntil ? .45 : 1;
      const empMultiplier = now < player.empUntil ? .5 : 1;
      player.y += player.direction * player.speed * (1 + s.elapsed * 0.018) * reloadMultiplier * empMultiplier * dt;
      player.x = player.side === 0 ? Math.min(player.x, s.width / 2 - 20) : Math.max(player.x, s.width / 2 + 20);
    }
    if (now < player.empUntil) player.aim = clampAim(player.side, player.aim + (Math.random() - .5) * dt * 1.8);
    if (player.y < 26) { player.y = 26; player.direction = 1; }
    if (player.y > s.height - 26) { player.y = s.height - 26; player.direction = -1; }
    if (s.suddenDeath.active) {
      const left = 26 + inset, right = s.width - 26 - inset;
      if (player.side === 0 && player.x < left) player.x = left;
      if (player.side === 1 && player.x > right) player.x = right;
    }
    player.recoil = Math.max(0, player.recoil - dt * 5);
    if (player.burstShots > 0 && now >= player.burstNextAt) {
      addBullet(s, player);
      player.burstShots--;
      player.burstNextAt = now + .12;
      s.matchStats[player.side].shots++;
      updateChallenge(data.profiles[room.profileIds[player.side]], "shots", 1);
    }
    if (s.suddenDeath.active) {
      const inDanger = player.x < 26 + inset || player.x > s.width - 26 - inset ||
        player.y < 26 + inset || player.y > s.height - 26 - inset;
      player.dangerElapsed = inDanger ? (player.dangerElapsed || 0) + dt : 0;
      if (player.dangerElapsed >= 1) {
        player.dangerElapsed -= 1;
        player.shield = Math.max(0, player.shield - 1);
        if (player.shield <= 0) { finishRound(room, 1 - player.side); return; }
      }
    } else player.dangerElapsed = 0;
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
    const obstacle = (s.obstacles || []).find(item =>
      bullet.x >= item.x && bullet.x <= item.x + item.width &&
      bullet.y >= item.y && bullet.y <= item.y + item.height
    );
    if (obstacle) {
      if (bullet.piercing && !bullet.piercingObstacle) bullet.piercingObstacle = obstacle;
      else if (bullet.piercingObstacle !== obstacle) { s.bullets.splice(index, 1); continue; }
    } else if (bullet.piercingObstacle) {
      bullet.piercing = false;
      bullet.piercingObstacle = null;
    }
    if (Math.hypot(target.x - bullet.x, target.y - bullet.y) < 17) {
      if (now < target.reflectUntil && !bullet.reflected) {
        bullet.owner = target.side;
        bullet.vx = -bullet.vx;
        bullet.vy = -bullet.vy;
        bullet.reflected = true;
        bullet.x += bullet.vx * .04;
        continue;
      }
      s.bullets.splice(index, 1);
      if (now < target.dodgeUntil) {
        target.successfulDodges++;
        if (target.ammo === 0 && target.successfulDodges % 3 === 0) target.ammo = Math.min(MAX_AMMO, target.ammo + 2);
        continue;
      }
      s.matchStats[bullet.owner].hits++;
      s.matchStats[bullet.owner].damage++;
      target.shield = Math.max(0, target.shield - 1);
      if (target.shield <= 0) {
        finishRound(room, bullet.owner);
        break;
      }
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
  removeFromRankedQueue(socket);
  if (socket.lobbyId) removeFromPrivateLobby(socket);
  if (socket.tournamentId) {
    const tournament = tournaments.get(socket.tournamentId);
    const participant = tournament?.players.find(player => player.socket === socket);
    if (participant) {
      participant.disconnected = true;
      participant.socket = null;
      if (tournament.activeRoom && tournament.activeRoom.players.includes(socket)) {
        finishMatch(tournament.activeRoom, 1 - socket.seat);
      }
    }
    socket.tournamentId = null;
  }
  const room = validRoom(socket);
  if (!room) return;
  if (room.state?.phase !== "matchEnd" && !room.recorded) {
    const winner = socket.seat === 0 ? 1 : 0;
    const opponent = room.players[winner];
    send(opponent, { type: "error", message: "L'avversario ha abbandonato. Vittoria a tavolino." });
    finishMatch(room, winner);
  } else closeRoom(room);
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
  const jsonResponse = (status, body) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    });
    response.end(JSON.stringify(body));
  };
  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    response.end();
    return;
  }
  if (url.pathname === "/api/cpu-leaderboard" && request.method === "GET") {
    const level = url.searchParams.get("difficulty");
    const levels = level ? [level] : ["easy", "medium", "hard"];
    const sorted = levels.flatMap(difficulty => Object.values(data.cpuRecords[difficulty] || {}))
      .sort((a, b) => b.xp - a.xp || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
    jsonResponse(200, { records: sorted });
    return;
  }
  if (url.pathname === "/api/cpu-records" && request.method === "POST") {
    let body = "";
    let tooLarge = false;
    request.on("data", chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 16384) {
        tooLarge = true;
        response.writeHead(413, { "Access-Control-Allow-Origin": "*" });
        response.end("Payload too large");
      }
    });
    request.on("end", () => {
      if (tooLarge) return;
      let entry;
      try { entry = JSON.parse(body); }
      catch (error) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        response.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const levels = { easy: 15, medium: 30, hard: 55 };
      if (!entry || typeof entry.id !== "string" || entry.id.length > 100 ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.profileId || "") ||
          !levels[entry.difficulty] ||
          !["win", "loss", "draw"].includes(entry.result)) {
        jsonResponse(400, { error: "Invalid CPU record" });
        return;
      }
      const profile = data.profiles[entry.profileId];
      const token = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!profile || !token || token !== profile.accessToken) {
        jsonResponse(401, { error: "Profile authentication failed" });
        return;
      }
      if (!data.cpuEvents.includes(entry.id)) {
        updateCpuRecord(profile, entry.difficulty, entry.result);
        data.cpuEvents.push(entry.id);
        data.cpuEvents = data.cpuEvents.slice(-5000);
        schedulePersist();
      }
      jsonResponse(200, { ok: true });
    });
    return;
  }
  if (url.pathname === "/api/profile" && request.method === "GET") {
    const profile = data.profiles[url.searchParams.get("id")];
    const token = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!profile || token !== profile.accessToken) {
      jsonResponse(401, { error: "Profile authentication failed" });
      return;
    }
    jsonResponse(200, { profile: profileView(profile) });
    return;
  }
  if (url.pathname === "/api/rankings" && request.method === "GET") {
    const rankings = Object.values(data.profiles).map(profile => profileView(profile))
      .sort((a, b) => b.rankXp - a.rankXp || a.nickname.localeCompare(b.nickname)).slice(0, 100);
    jsonResponse(200, { records: rankings });
    return;
  }
  if (url.pathname === "/api/leaderboard" && request.method === "GET") {
    const sorted = Object.values(data.officialRecords).sort((a, b) =>
      b.rankXp - a.rankXp || b.wins - a.wins || a.nickname.localeCompare(b.nickname)
    );
    jsonResponse(200, { records: sorted });
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
    if (message.type === "hello" && !socket.profile) {
      if (!SHIPS[message.shipId]) {
        send(socket, { type: "error", message: "Navicella selezionata non valida." });
        return;
      }
      socket.shipId = message.shipId;
      socket.profile = authenticateProfile(message.profileId, message.accessToken, message.nickname);
      socket.profileId = socket.profile.id;
      send(socket, { type: "profile", profile: profileView(socket.profile, true) });
      return;
    }
    if (!socket.profile) {
      send(socket, { type: "error", message: "Profilo non autenticato." });
      return;
    }
    if (message.type === "queue" && !socket.roomId && !socket.lobbyId) {
      removeFromRankedQueue(socket);
      if (message.mode === "ranked") queueRanked(socket);
      else if (message.mode === "friendly") queueFriendly(socket);
      else send(socket, { type: "error", message: "Modalità matchmaking non valida." });
    } else if (message.type === "create_lobby" && !socket.roomId && !socket.lobbyId) {
      createPrivateLobby(socket, message.kind);
    } else if (message.type === "join_lobby" && !socket.roomId && !socket.lobbyId) {
      if (message.kind === "tournament") joinTournament(socket, message.code);
      else if (message.kind === "friendly") joinPrivateLobby(socket, message.code, "friendly");
      else send(socket, { type: "error", message: "Tipo lobby non valido." });
    } else if (message.type === "start_tournament" && !socket.roomId) {
      startTournament(socket, message.code);
    } else if (message.type === "action") handleAction(socket, message);
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

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  store.save();
  wss.clients.forEach(client => client.close(1001, "Server shutting down"));
  wss.close();
  server.close(() => process.exit(0));
  const timeout = setTimeout(() => process.exit(1), 5000);
  timeout.unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
