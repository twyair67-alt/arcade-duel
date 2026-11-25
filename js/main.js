import { AssetLoader } from "./assets.js";
import { ArcadeAudio } from "./audio.js";
import { Game } from "./game.js";
import { InputController } from "./input.js";
import { Leaderboard, fetchGlobalLeaderboard } from "./leaderboard.js";

const $ = id => document.getElementById(id);
const home = $("home-screen"), gameScreen = $("game-screen"), boardScreen = $("leaderboard-screen");
const canvas = $("arena"), assets = new AssetLoader(), audio = new ArcadeAudio(), leaderboard = new Leaderboard();
let nickname = localStorage.getItem("arcade-duel-nickname") || "AAA";
let game = null, input = null, network = null, currentMode = null, resultRecorded = false;

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
  [home, gameScreen, boardScreen].forEach(item => item.classList.add("hidden"));
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
  setHudText("left-ammo", ammoText(state.players[0]?.ammo || 0));
  setHudText("right-ammo", ammoText(state.players[1]?.ammo || 0));
  const now = Date.now() / 1000;
  setHudText("left-dodge", dodgeText(state.players[0], now));
  setHudText("right-dodge", dodgeText(state.players[1], now));
  setHudText("touch-dodge-status", dodgeText(state.players[game?.localSide || 0], now).replace("SCHIVA: ", ""));
  if (state.phase === "playing") setHudText("game-status", currentMode === "online" ? "1 VS 1" : "VS CPU");
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

function showOverlay(message, buttonLabel, action) {
  $("overlay-message").textContent = message;
  $("overlay-action").textContent = buttonLabel;
  $("overlay-action").onclick = action;
  $("game-overlay").classList.remove("hidden");
}

function setGameStatus(message) { $("game-status").textContent = message; }

function startGame(mode, onlineData = null) {
  currentMode = mode;
  resultRecorded = false;
  audio.stopLobby();
  showScreen(gameScreen);
  $("game-overlay").classList.add("hidden");
  $("game-status").textContent = mode === "online" ? "CONNESSO" : "VS CPU";
  const rect = canvas.getBoundingClientRect();
  game = new Game(canvas, assets, audio, {
    mode, network, localSide: onlineData?.seat || 0, playerName: nickname,
    cpuName: onlineData?.names?.[1] || "CPU",
    onState: state => {
      updateHud(state);
      if (state.phase === "roundEnd" && mode === "cpu" && $("game-overlay").classList.contains("hidden")) {
        const winner = state.roundWinner === null ? "ROUND PAREGGIATO" : state.roundWinner === 0 ? "ROUND VINTO" : "ROUND PERSO";
        showOverlay(winner, "PROSSIMO ROUND", () => {
          $("game-overlay").classList.add("hidden");
          game.nextRound();
        });
      }
    },
    onResult: result => {
      if (resultRecorded) return;
      resultRecorded = true;
      audio.stopLobby();
      if (mode === "online") leaderboard.recordLocal(nickname, result);
      const message = result === "win" ? "VITTORIA!" : result === "loss" ? "SCONFITTA" : "PAREGGIO";
      if (result === "win") audio.victory();
      showOverlay(message, "TORNA AL MENU", () => returnHome());
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

function socketUrl() {
  if (window.ARCADE_SERVER_URL) return window.ARCADE_SERVER_URL;
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

function playOnline() {
  audio.unlock();
  audio.startLobby();
  showScreen(gameScreen);
  $("game-overlay").classList.remove("hidden");
  showOverlay("RICERCA AVVERSARIO...", "ANNULLA", () => returnHome());
  setGameStatus("MATCHMAKING");
  const socket = new WebSocket(socketUrl());
  network = socket;
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "join", nickname })));
  socket.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(event.data); }
    catch (error) { console.error("Messaggio server non valido:", error); return; }
    if (message.type === "waiting") {
      showOverlay("IN ATTESA DI UN AVVERSARIO...", "ANNULLA", () => returnHome());
      setGameStatus("IN ATTESA");
    } else if (message.type === "match_started") {
      startGame("online", message);
      setGameStatus("1 VS 1");
    } else if (message.type === "state" || message.type === "round_end" || message.type === "match_end") {
      if (game) game.applyNetworkMessage(message);
      if (message.type === "round_end") {
        $("game-overlay").classList.remove("hidden");
        $("overlay-message").textContent = message.winner === null ? "ROUND PAREGGIATO" : message.winner === game.localSide ? "ROUND VINTO" : "ROUND PERSO";
        $("overlay-action").textContent = "ROUND SUCCESSIVO...";
        $("overlay-action").onclick = () => {};
      } else if (message.type === "state" && message.state.phase === "playing") {
        $("game-overlay").classList.add("hidden");
      }
    } else if (message.type === "error") {
      setGameStatus("ERRORE");
      showOverlay(message.message || "ERRORE SERVER", "TORNA AL MENU", () => returnHome());
    }
  });
  socket.addEventListener("error", () => {
    setGameStatus("OFFLINE");
    showOverlay("SERVER NON DISPONIBILE", "GIOCA VS CPU", () => {
      if (network === socket) network = null;
      socket.close();
      startGame("cpu");
    });
  });
  socket.addEventListener("close", () => {
    if (network !== socket) return;
    audio.stopLobby();
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

renderNickname();
$("play-cpu").addEventListener("click", playCpu);
$("play-online").addEventListener("click", playOnline);
$("show-global").addEventListener("click", () => showLeaderboard(true));
$("show-local").addEventListener("click", () => showLeaderboard(false));
$("back-home").addEventListener("click", returnHome);
$("leaderboard-back").addEventListener("click", () => showScreen(home));
window.addEventListener("resize", resizeCanvas);
