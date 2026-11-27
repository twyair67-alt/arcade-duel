import { AssetLoader } from "./assets.js";
import { ArcadeAudio } from "./audio.js";
import { Game } from "./game.js";
import { InputController } from "./input.js";
import { Leaderboard, CpuLeaderboard, fetchGlobalLeaderboard } from "./leaderboard.js";
import { SHIPS } from "./entities.js";

const $ = id => document.getElementById(id);
const home = $("home-screen"), gameScreen = $("game-screen"), boardScreen = $("leaderboard-screen"), rosterScreen = $("roster-screen");
const canvas = $("arena"), assets = new AssetLoader(), audio = new ArcadeAudio(), leaderboard = new Leaderboard(), cpuLeaderboard = new CpuLeaderboard();
const PROFILE_STORAGE_KEY = "arcade-duel-profile-v1";
let nickname = localStorage.getItem("arcade-duel-nickname") || "AAA";
let selectedShipId = SHIPS[localStorage.getItem("arcade-duel-ship")] ? localStorage.getItem("arcade-duel-ship") : "viper";
let game = null, input = null, network = null, currentMode = null, currentMatchType = null, resultRecorded = false;
let pendingSocketRequest = null, activeLobby = null;
function makeUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const random = Math.random() * 16 | 0;
    return (character === "x" ? random : (random & 3 | 8)).toString(16);
  });
}
function readProfileIdentity() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null");
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.id)) return saved;
  } catch (error) {
    console.error("Impossibile leggere il profilo locale:", error);
  }
  return { id: makeUuid(), accessToken: null };
}
let profileIdentity = readProfileIdentity();
function saveProfileIdentity() {
  try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileIdentity)); }
  catch (error) { console.error("Impossibile salvare il profilo locale:", error); }
}
window.arcadeDuelShipId = selectedShipId;
window.arcadeDuelProfileId = profileIdentity.id;

function saveNickname() {
  nickname = nickname.replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "A");
  localStorage.setItem("arcade-duel-nickname", nickname);
}

function renderNickname() {
  const slots = $("nickname-slots");
  slots.replaceChildren();
  for (let index = 0; index < 3; index++) {
    const slot = document.createElement("div");
    slot.className = "letter-slot";
    const up = document.createElement("button");
    up.type = "button"; up.textContent = "▲"; up.setAttribute("aria-label", `Lettera ${index + 1} successiva`);
    const output = document.createElement("output");
    output.textContent = nickname[index];
    output.setAttribute("aria-label", `Lettera ${index + 1}: ${nickname[index]}`);
    const down = document.createElement("button");
    down.type = "button"; down.textContent = "▼"; down.setAttribute("aria-label", `Lettera ${index + 1} precedente`);
    const change = amount => {
      const code = nickname.charCodeAt(index) - 65;
      nickname = nickname.slice(0, index) + String.fromCharCode(65 + (code + amount + 26) % 26) + nickname.slice(index + 1);
      saveNickname(); renderNickname();
    };
    up.addEventListener("click", () => change(1));
    down.addEventListener("click", () => change(-1));
    slot.append(up, output, down);
    slots.append(slot);
  }
}

function showScreen(screen) {
  [home, gameScreen, boardScreen, rosterScreen, $("tournament-lobby-screen")].forEach(item => item.classList.add("hidden"));
  screen.classList.remove("hidden");
}

function resizeCanvas() {
  if (!game) return;
  game.resize(canvas.clientWidth, canvas.clientHeight);
}

function updateHud(state) {
  if (!state) return;
  setHudText("round-label", `ROUND ${state.round} / ${state.totalRounds || 3}  ·  ${state.roundWins?.[0] || 0}-${state.roundWins?.[1] || 0}`);
  setHudText("timer", Math.ceil(state.seconds || 0));
  setHudText("left-name", state.players[0]?.name || nickname);
  setHudText("right-name", state.players[1]?.name || (currentMode === "cpu" ? "CPU" : "AVVERSARIO"));
  setHudText("left-shield", `SCUDO: ${state.players[0]?.shield ?? 0}/${state.players[0]?.maxShield ?? 0}`);
  setHudText("right-shield", `SCUDO: ${state.players[1]?.shield ?? 0}/${state.players[1]?.maxShield ?? 0}`);
  setHudText("left-ammo", ammoText(state.players[0]?.ammo || 0));
  setHudText("right-ammo", ammoText(state.players[1]?.ammo || 0));
  const now = Date.now() / 1000;
  setHudText("left-dodge", dodgeText(state.players[0], now));
  setHudText("right-dodge", dodgeText(state.players[1], now));
  const localPlayer = state.players[game?.localSide || 0];
  const canSweetReload = localPlayer && now - localPlayer.lastReloadAt >= 4.5 && now - localPlayer.lastReloadAt <= 5.5;
  setHudText("touch-dodge-status", dodgeText(localPlayer, now).replace("SCHIVA: ", ""));
  setHudText("left-reload", reloadText(state.players[0], now));
  setHudText("right-reload", reloadText(state.players[1], now));
  setHudText("left-skill", skillText(state.players[0], now));
  setHudText("right-skill", skillText(state.players[1], now));
  setHudText("touch-reload-status", reloadText(localPlayer, now).replace("RELOAD: ", ""));
  setHudText("touch-skill-status", skillText(localPlayer, now).replace("SKILL: ", ""));
  $("reload-control").disabled = !localPlayer || localPlayer.ammo >= 5 || (now < localPlayer.reloadReadyAt && !canSweetReload);
  $("skill-control").disabled = !localPlayer || now < localPlayer.abilityReadyAt;
  if (state.phase === "playing") {
    const onlineStatus = currentMatchType === "ranked" ? "RANKED" : currentMatchType === "tournament" ? "TORNEO" : "AMICHEVOLE";
    setHudText("game-status", currentMode === "online" ? onlineStatus : currentMode === "training" ? "ALLENAMENTO" : `CPU ${$("cpu-difficulty").value.toUpperCase()}`);
  }
}

function setHudText(id, value) {
  const element = $(id);
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function ammoText(amount) { return `${"● ".repeat(amount)}${"○ ".repeat(Math.max(0, 5 - amount))}`.trim(); }
function dodgeText(player, now) {
  if (!player) return "SCHIVA: --";
  if (now < player.cooldownUntil) return `SCHIVA: ${(player.cooldownUntil - now).toFixed(1)}s`;
  if (now < player.dodgeUntil) return "SCHIVA: ATTIVA";
  return "SCHIVA: PRONTA";
}
function reloadText(player, now) {
  if (!player) return "RELOAD: --";
  if (player.ammo >= 5) return "RELOAD: PIENO";
  if (now < player.reloadReadyAt) {
    const elapsed = now - player.lastReloadAt;
    if (elapsed >= 4.5 && elapsed <= 5.5) return "RELOAD: SWEET SPOT!";
    return `RELOAD: ${(player.reloadReadyAt - now).toFixed(1)}s`;
  }
  return "RELOAD: PRONTO";
}
function skillText(player, now) {
  if (!player) return "SKILL: --";
  return now < player.abilityReadyAt ? `SKILL: ${(player.abilityReadyAt - now).toFixed(1)}s` : "SKILL: PRONTA";
}

function showOverlay(message, buttonLabel, action) {
  $("overlay-message").textContent = message;
  $("overlay-action").textContent = buttonLabel;
  $("overlay-action").onclick = action;
  $("game-overlay").classList.remove("hidden");
}

function setGameStatus(message) { $("game-status").textContent = message; }

function renderProfile(profile) {
  if (!profile) return;
  profileIdentity = { ...profileIdentity, ...profile };
  window.arcadeDuelProfileId = profileIdentity.id;
  saveProfileIdentity();
  const division = profile.division?.name || "Legno";
  const rankXp = profile.rankXp || 0;
  const nextDivision = profile.division?.next || (profile.division ? null : { name: "Bronzo", xp: 100 });
  $("profile-rank").textContent = `RANK: ${division.toUpperCase()} · ${rankXp} XP`;
  $("rank-progress").value = Math.max(0, Math.min(1, Number(profile.division?.progress) || 0));
  $("rank-next").textContent = nextDivision
    ? `PROSSIMA DIVISIONE: ${nextDivision.name} · ${Math.max(0, nextDivision.xp - rankXp)} XP`
    : "RANGO MASSIMO";
  const challenges = profile.challenges?.items || {
    shots: { progress: 0, target: 20, complete: false },
    reloads: { progress: 0, target: 5, complete: false },
    wins: { progress: 0, target: 1, complete: false }
  };
  const titles = { shots: "Spara 20 colpi", reloads: "Ricarica 5 volte", wins: "Vinci una partita online" };
  $("daily-challenges").replaceChildren(...Object.entries(challenges).map(([id, challenge]) => {
    const item = document.createElement("span");
    item.textContent = `${challenge.complete ? "✓" : "·"} ${titles[id] || id}: ${challenge.progress}/${challenge.target}`;
    return item;
  }));
  const cosmetics = profile.challenges?.cosmetics || [];
  $("profile-cosmetics").textContent = cosmetics.length
    ? `COSMETICI SBLOCCATI: ${cosmetics.join(", ").toUpperCase()}`
    : "COSMETICI SBLOCCATI: NESSUNO";
}

function startGame(mode, onlineData = null) {
  if (game) game.stop();
  currentMode = mode;
  currentMatchType = onlineData?.mode || null;
  resultRecorded = false;
  audio.stopLobby();
  showScreen(gameScreen);
  $("game-overlay").classList.add("hidden");
  $("game-status").textContent = mode === "online" ? "CONNESSO" : mode === "training" ? "ALLENAMENTO · 0 XP" : `CPU ${$("cpu-difficulty").value.toUpperCase()}`;
  const rect = canvas.getBoundingClientRect();
  game = new Game(canvas, assets, audio, {
    mode, network, difficulty: $("cpu-difficulty").value, shipId: selectedShipId,
    localSide: onlineData?.seat || 0, playerName: nickname,
    cpuName: onlineData?.names?.[1] || "CPU",
    onState: state => {
      updateHud(state);
      if (state.phase === "roundEnd" && mode !== "online" && $("game-overlay").classList.contains("hidden")) {
        const winner = state.roundWinner === null ? "ROUND PAREGGIATO" : state.roundWinner === 0 ? "ROUND VINTO" : "ROUND PERSO";
        showOverlay(winner, "PROSSIMO ROUND", () => {
          $("game-overlay").classList.add("hidden");
          game.nextRound();
        });
      }
    },
    onResult: (result, stats = null, updatedProfile = null, rankDelta = 0) => {
      if (resultRecorded) return;
      resultRecorded = true;
      audio.stopLobby();
      if (updatedProfile) renderProfile(updatedProfile);
      if (mode === "online" && currentMatchType === "ranked") leaderboard.recordLocal(nickname, result);
      if (mode === "cpu") {
        try {
          cpuLeaderboard.recordMatch(nickname, $("cpu-difficulty").value, result, game.state.roundWins[game.localSide], profileIdentity);
          cpuLeaderboard.sync(profileIdentity);
        } catch (error) {
          console.error("Impossibile salvare il record CPU:", error);
        }
      }
      const cpuXp = { easy: 15, medium: 30, hard: 55 }[$("cpu-difficulty").value];
      const actualStats = stats || game.state.matchStats?.[game.localSide] || { shots: 0, hits: 0, damage: 0, reloads: 0 };
      const accuracy = actualStats.shots ? Math.round(actualStats.hits * 100 / actualStats.shots) : 0;
      const outcome = result === "win" ? "VITTORIA" : result === "loss" ? "SCONFITTA" : "PAREGGIO";
      const reward = mode === "cpu" ? ` · +${result === "win" ? cpuXp : 0} XP CPU`
        : mode === "training" ? " · 0 XP"
          : currentMatchType === "ranked" && updatedProfile
            ? ` · ${rankDelta >= 0 ? "+" : ""}${rankDelta} XP RANK · TOTALE ${updatedProfile.rankXp} (${updatedProfile.division?.name || "Legno"})`
            : currentMatchType === "tournament" ? " · XP TORNEO A FINE TORNEO"
              : currentMatchType === "friendly" ? " · 0 XP · NO RANK" : "";
      const message = `${outcome}${reward}\nCOLPI ${actualStats.shots} · PRECISIONE ${accuracy}% · DANNI ${actualStats.damage}\nRICARICHE ${actualStats.reloads}`;
      if (result === "win") audio.victory();
      if (mode === "online" && currentMatchType === "tournament") {
        showOverlay(`${message}\nIN ATTESA DEL PROSSIMO INCONTRO`, "CONTINUA TORNEO", () => $("game-overlay").classList.add("hidden"));
      } else showOverlay(message, "TORNA AL MENU", () => returnHome());
    }
  });
  if (onlineData?.state) game.applyNetworkState(onlineData.state);
  if (!input) input = new InputController(canvas, game, audio);
  else input.setGame(game);
  requestAnimationFrame(() => { resizeCanvas(); game.start(); });
  window.addEventListener("resize", resizeCanvas);
}

async function playCpu() {
  audio.unlock();
  startGame("cpu");
}

function playTraining() {
  audio.unlock();
  startGame("training");
}

function renderRoster() {
  const list = $("roster-list");
  list.replaceChildren();
  Object.values(SHIPS).forEach(ship => {
    const card = document.createElement("article");
    card.className = `roster-card${selectedShipId === ship.id ? " selected" : ""}`;
    card.style.setProperty("--ship-color", ship.color);
    const title = document.createElement("h3");
    title.textContent = ship.name;
    const stats = document.createElement("p");
    stats.textContent = `VELOCITÀ ${ship.speed} · FUOCO ${ship.fire} · SCUDO ${ship.shield} · TOTALE ${ship.speed + ship.fire + ship.shield}`;
    const ability = document.createElement("p");
    ability.textContent = `${ship.ability} · COOLDOWN ${ship.abilityCooldown}s`;
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "menu-button";
    choose.textContent = selectedShipId === ship.id ? "SELEZIONATA" : "SELEZIONA";
    choose.addEventListener("click", () => {
      selectedShipId = ship.id;
      window.arcadeDuelShipId = ship.id;
      localStorage.setItem("arcade-duel-ship", ship.id);
      renderRoster();
    });
    card.append(title, stats, ability, choose);
    list.append(card);
  });
}

function socketUrl() {
  if (window.ARCADE_SERVER_URL) return window.ARCADE_SERVER_URL;
  if (window.arcadeDesktop?.serverUrl) return window.arcadeDesktop.serverUrl;
  const secure = location.protocol === "https:";
  const scheme = secure ? "wss:" : "ws:";
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  if (location.protocol === "file:" || !location.host || localHost) {
    const hostname = location.hostname || "localhost";
    const authority = hostname.includes(":") ? `[${hostname}]` : hostname;
    return `${scheme}//${authority}:8080`;
  }
  return `${scheme}//${location.host}`;
}

function connectAndRequest(request, initialScreen = gameScreen) {
  audio.unlock();
  if (network) {
    if (network.readyState === WebSocket.OPEN) network.send(JSON.stringify({ type: "leave" }));
    network.close();
    network = null;
  }
  showScreen(initialScreen);
  if (initialScreen === gameScreen) {
    audio.startLobby();
    $("game-overlay").classList.remove("hidden");
    showOverlay("CONNESSIONE AL SERVER...", "ANNULLA", () => returnHome());
    setGameStatus("CONNESSIONE");
  }
  pendingSocketRequest = request;
  const socket = new WebSocket(socketUrl());
  network = socket;
  socket.profileReady = false;
  socket.addEventListener("open", () => socket.send(JSON.stringify({
    type: "hello", profileId: profileIdentity.id, accessToken: profileIdentity.accessToken, nickname, shipId: selectedShipId
  })));
  socket.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(event.data); }
    catch (error) { console.error("Messaggio server non valido:", error); return; }
    if (message.type === "profile") {
      socket.profileReady = true;
      renderProfile(message.profile);
      cpuLeaderboard.sync(profileIdentity);
      if (pendingSocketRequest && network === socket) {
        socket.send(JSON.stringify(pendingSocketRequest));
        if (pendingSocketRequest.type === "queue") {
          showOverlay("RICERCA AVVERSARIO...", "ANNULLA", () => returnHome());
          setGameStatus("MATCHMAKING");
        }
        pendingSocketRequest = null;
      }
    } else if (message.type === "waiting") {
      if (initialScreen === gameScreen) {
        showOverlay("IN ATTESA DI UN AVVERSARIO...", "ANNULLA", () => returnHome());
        setGameStatus(message.mode === "ranked" ? "MATCHMAKING RANKED" : "AMICHEVOLE");
      }
    } else if (message.type === "private_lobby") {
      activeLobby = message.lobby;
      showScreen($("tournament-lobby-screen"));
      $("lobby-code").textContent = activeLobby.code;
      $("lobby-title").textContent = activeLobby.kind === "tournament" ? "TORNEO PRIVATO" : "AMICHEVOLE PRIVATA";
      $("lobby-status").textContent = activeLobby.kind === "tournament"
        ? `${activeLobby.players.length}/16 GIOCATORI · MINIMO 4 PER INIZIARE`
        : "IN ATTESA DELL'AVVERSARIO · NESSUN IMPATTO SUL RANK";
      $("lobby-players").replaceChildren(...activeLobby.players.map(player => {
        const item = document.createElement("li");
        item.className = player.isHost ? "host" : "";
        item.textContent = player.nickname;
        return item;
      }));
      $("tournament-public-note").classList.toggle("hidden", activeLobby.kind !== "tournament");
      $("tournament-start").classList.toggle("hidden", activeLobby.kind !== "tournament");
      const isHost = activeLobby.players.some(player => player.profileId === profileIdentity.id && player.isHost);
      $("tournament-start").disabled = activeLobby.kind !== "tournament" || !activeLobby.canStart || !isHost;
      $("tournament-start").textContent = !isHost ? "IN ATTESA DELL'HOST" : activeLobby.canStart ? "GIOCA" : "GIOCA · MINIMO 4 GIOCATORI";
    } else if (message.type === "emote") {
      game?.applyEmote(message.side, message.emote);
    } else if (message.type === "match_started") {
      startGame("online", message);
      activeLobby = null;
      setGameStatus(message.mode === "ranked" ? "RANKED" : message.mode === "tournament" ? "TORNEO" : "AMICHEVOLE · NO RANK");
    } else if (message.type === "tournament_progress") {
      setGameStatus(`TORNEO · ROUND ${message.round} · MATCH ${message.match}/${message.totalMatches}`);
    } else if (message.type === "tournament_complete") {
      const own = message.standings.find(player => player.profileId === profileIdentity.id);
      const summary = own ? `TORNEO TERMINATO · ${own.place}° POSTO · +${own.xp} XP TORNEO` : "TORNEO TERMINATO";
      if (game) showOverlay(summary, "TORNA AL MENU", () => returnHome());
      else { showScreen(home); window.alert(summary); }
    } else if (message.type === "state" || message.type === "round_end" || message.type === "match_end") {
      if (game) game.applyNetworkMessage(message);
      if (message.type === "match_end" && message.profile) renderProfile(message.profile);
      if (message.type === "round_end") {
        $("game-overlay").classList.remove("hidden");
        $("overlay-message").textContent = message.winner === null ? "ROUND PAREGGIATO" : message.winner === game.localSide ? "ROUND VINTO" : "ROUND PERSO";
        $("overlay-action").textContent = "ROUND SUCCESSIVO...";
        $("overlay-action").onclick = () => {};
      } else if (message.type === "state" && message.state.phase === "playing") {
        $("game-overlay").classList.add("hidden");
      }
    } else if (message.type === "error") {
      if (initialScreen === $("tournament-lobby-screen")) $("lobby-status").textContent = message.message || "ERRORE SERVER";
      else {
        setGameStatus("ERRORE");
        showOverlay(message.message || "ERRORE SERVER", "TORNA AL MENU", () => returnHome());
      }
    }
  });
  socket.addEventListener("error", () => {
    pendingSocketRequest = null;
    if (!$("tournament-lobby-screen").classList.contains("hidden")) $("lobby-status").textContent = "SERVER NON DISPONIBILE";
    else {
      setGameStatus("OFFLINE");
      if (game) showOverlay("CONNESSIONE PERSA", "TORNA AL MENU", () => returnHome());
      else showOverlay("SERVER NON DISPONIBILE", "GIOCA VS CPU", () => {
          if (network === socket) network = null;
          socket.close();
          startGame("cpu");
        });
    }
  });
  socket.addEventListener("close", () => {
    if (network !== socket) return;
    audio.stopLobby();
    if (!$("tournament-lobby-screen").classList.contains("hidden")) {
      $("lobby-status").textContent = "CONNESSIONE PERSA";
      return;
    }
    if (resultRecorded || gameScreen.classList.contains("hidden")) return;
    if (currentMode === "online" && game) {
      showOverlay("CONNESSIONE PERSA", "TORNA AL MENU", () => returnHome());
    } else if (!game) {
      setGameStatus("OFFLINE");
      showOverlay("SERVER NON DISPONIBILE", "GIOCA VS CPU", () => {
        network = null;
        startGame("cpu");
      });
    }
  });
}

function playOnline() { connectAndRequest({ type: "queue", mode: "ranked" }); }
function playFriendly() { connectAndRequest({ type: "queue", mode: "friendly" }); }

function joinPrivateRoom(kind) {
  const input = $(kind === "friendly" ? "friendly-code" : "tournament-code");
  const code = input.value.trim().toUpperCase();
  if (code) connectAndRequest({ type: "join_lobby", kind, code }, $("tournament-lobby-screen"));
}

function handleRoomCodeKeydown(event, kind) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  joinPrivateRoom(kind);
}

function returnHome() {
  if (network && network.readyState === WebSocket.OPEN) network.send(JSON.stringify({ type: "leave" }));
  if (network) { network.close(); network = null; }
  if (game) { game.stop(); game = null; }
  audio.stopLobby();
  currentMode = null;
  showScreen(home);
}

async function showLeaderboard(global) {
  showScreen(boardScreen);
  $("leaderboard-title").textContent = global ? "CLASSIFICA GLOBALE" : "CLASSIFICA LOCALE";
  const content = $("leaderboard-content");
  content.innerHTML = '<p class="empty-board">CARICAMENTO...</p>';
  try {
    const records = global ? await fetchGlobalLeaderboard() : leaderboard.getLocal();
    content.innerHTML = leaderboard.render(records);
  } catch (error) {
    console.error("Impossibile caricare la classifica globale:", error);
    content.innerHTML = '<p class="empty-board">SERVER NON DISPONIBILE. AVVIA server/server.js</p>';
  }
}

async function showRankings() {
  showScreen(boardScreen);
  $("leaderboard-title").textContent = "ZONA RANGHI · CLASSIFICA";
  const content = $("leaderboard-content");
  content.innerHTML = '<p class="empty-board">CARICAMENTO...</p>';
  try {
    const response = await fetch(`${httpBase()}/api/rankings`);
    if (!response.ok) throw new Error(`Classifica Rank: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.records)) throw new Error("Risposta classifica Rank non valida");
    const escape = value => String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
    content.innerHTML = body.records.length
      ? `<table class="leaderboard-table"><thead><tr><th>#</th><th>NICK</th><th>DIVISIONE</th><th>XP RANK</th><th>V</th><th>S</th></tr></thead><tbody>${body.records.map((record, index) =>
        `<tr><td>${index + 1}</td><td>${escape(record.nickname)}</td><td>${escape(record.division.name)}</td><td>${record.rankXp}</td><td>${record.stats.wins}</td><td>${record.stats.losses}</td></tr>`
      ).join("")}</tbody></table>`
      : '<p class="empty-board">NESSUN PROFILO IN CLASSIFICA</p>';
  } catch (error) {
    console.error("Impossibile caricare la classifica Rank:", error);
    content.innerHTML = '<p class="empty-board">CLASSIFICA RANK NON DISPONIBILE. CONNESSIONE AL SERVER RICHIESTA.</p>';
  }
}

async function showCpuLeaderboard(global = false) {
  showScreen(boardScreen);
  $("leaderboard-title").textContent = global ? "CLASSIFICA GLOBALE CPU" : "CLASSIFICA CPU PERSONALE";
  const content = $("leaderboard-content");
  content.innerHTML = '<p class="empty-board">CARICAMENTO...</p>';
  try {
    if (global) {
      await cpuLeaderboard.sync(profileIdentity);
      content.innerHTML = cpuLeaderboard.renderGlobal(await cpuLeaderboard.getGlobal());
    } else {
      content.innerHTML = cpuLeaderboard.renderLocal(cpuLeaderboard.getLocal());
    }
  } catch (error) {
    console.error("Impossibile caricare la classifica CPU:", error);
    content.innerHTML = '<p class="empty-board">CLASSIFICA CPU NON DISPONIBILE. I RECORD LOCALI RESTANO SALVATI.</p>';
  }
}

function httpBase() {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const fallback = location.protocol === "file:" || !location.host || localHost
    ? `http://${location.hostname || "localhost"}:8080`
    : location.origin;
  return (window.ARCADE_SERVER_HTTP || window.arcadeDesktop?.serverHttpUrl || fallback).replace(/\/$/, "");
}

renderNickname();
renderRoster();
renderProfile(profileIdentity);
saveProfileIdentity();
cpuLeaderboard.sync(profileIdentity);
window.addEventListener("online", () => cpuLeaderboard.sync(profileIdentity));
$("play-cpu").addEventListener("click", playCpu);
$("play-training").addEventListener("click", playTraining);
$("play-online").addEventListener("click", playOnline);
$("play-friendly").addEventListener("click", playFriendly);
$("create-friendly").addEventListener("click", () => connectAndRequest({ type: "create_lobby", kind: "friendly" }, $("tournament-lobby-screen")));
$("join-friendly").addEventListener("click", () => joinPrivateRoom("friendly"));
$("friendly-code").addEventListener("keydown", event => handleRoomCodeKeydown(event, "friendly"));
$("create-tournament").addEventListener("click", () => connectAndRequest({ type: "create_lobby", kind: "tournament" }, $("tournament-lobby-screen")));
$("join-tournament").addEventListener("click", () => joinPrivateRoom("tournament"));
$("tournament-code").addEventListener("keydown", event => handleRoomCodeKeydown(event, "tournament"));
$("tournament-start").addEventListener("click", () => {
  if (activeLobby?.canStart && network?.readyState === WebSocket.OPEN) {
    network.send(JSON.stringify({ type: "start_tournament", code: activeLobby.code }));
  }
});
$("lobby-back").addEventListener("click", returnHome);
$("show-rank").addEventListener("click", showRankings);
$("open-roster").addEventListener("click", () => { renderRoster(); showScreen(rosterScreen); });
$("roster-back").addEventListener("click", () => showScreen(home));
$("show-cpu").addEventListener("click", () => showCpuLeaderboard(false));
$("show-global-cpu").addEventListener("click", () => showCpuLeaderboard(true));
$("show-global").addEventListener("click", () => showLeaderboard(true));
$("show-local").addEventListener("click", () => showLeaderboard(false));
$("back-home").addEventListener("click", returnHome);
$("leaderboard-back").addEventListener("click", () => showScreen(home));
window.addEventListener("resize", resizeCanvas);
