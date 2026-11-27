"use strict";

const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const GAME_SCHEME = "arcade";
const GAME_HOST = "game";
const RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000];
const LOAD_TIMEOUT_MS = 120000;

protocol.registerSchemesAsPrivileged([{
  scheme: GAME_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

let gameWindow = null;
let loadingWindow = null;
let retryTimer = null;
let retryAttempt = 0;
let isLoadingGame = false;
let gameLoaded = false;
let isQuitting = false;

function gameAssetsPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "game")
    : path.resolve(__dirname, "..");
}

function registerGameProtocol() {
  const root = gameAssetsPath();
  protocol.handle(GAME_SCHEME, request => {
    const url = new URL(request.url);
    if (url.hostname !== GAME_HOST) return new Response("Not found", { status: 404 });

    let relativePath;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    } catch (error) {
      console.error("Invalid local game asset URL:", error);
      return new Response("Bad request", { status: 400 });
    }

    const filePath = path.resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
}

function sendLoadingStatus(phase, message) {
  if (!loadingWindow || loadingWindow.isDestroyed()) return;
  loadingWindow.webContents.send("arcade:connection-status", { phase, message });
}

function scheduleRetry(errorMessage) {
  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt - 1, RETRY_DELAYS_MS.length - 1)];
  const seconds = Math.round(delay / 1000);
  sendLoadingStatus(
    "retry",
    `${errorMessage}\n\nNuovo tentativo automatico tra ${seconds} secondi.`
  );
  retryTimer = setTimeout(() => {
    retryTimer = null;
    loadGame();
  }, delay);
}

async function loadGame() {
  if (isLoadingGame || gameLoaded || isQuitting || !gameWindow || gameWindow.isDestroyed()) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  retryAttempt++;
  isLoadingGame = true;
  sendLoadingStatus("connecting", `Avvio del client locale ARCADE DUEL... (tentativo ${retryAttempt})`);

  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    if (gameWindow && !gameWindow.isDestroyed()) gameWindow.webContents.stop();
  }, LOAD_TIMEOUT_MS);

  try {
    await gameWindow.loadURL(`${GAME_SCHEME}://${GAME_HOST}/index.html`);
    if (isQuitting || !gameWindow || gameWindow.isDestroyed()) return;
    gameLoaded = true;
    retryAttempt = 0;
    gameWindow.show();
    gameWindow.focus();
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
  } catch (error) {
    if (isQuitting || gameLoaded) return;
    const message = timedOut
      ? "Il client locale non si è avviato entro due minuti."
      : `Impossibile avviare il client locale (${String(error.message || error).slice(0, 140)}).`;
    scheduleRetry(message);
  } finally {
    clearTimeout(watchdog);
    isLoadingGame = false;
  }
}

function createWindows() {
  gameWindow = new BrowserWindow({
    title: "ARCADE DUEL",
    width: 1366,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  gameWindow.setMenuBarVisibility(false);
  gameWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  gameWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      if (target.protocol !== `${GAME_SCHEME}:` || target.hostname !== GAME_HOST) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  gameWindow.webContents.on("page-title-updated", event => event.preventDefault());
  gameWindow.on("closed", () => {
    gameWindow = null;
    gameLoaded = false;
  });

  loadingWindow = new BrowserWindow({
    width: 520,
    height: 360,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    title: "ARCADE DUEL - Connessione",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  loadingWindow.setMenuBarVisibility(false);
  loadingWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  loadingWindow.on("closed", () => {
    loadingWindow = null;
    if (!gameLoaded && !isQuitting) app.quit();
  });

  loadingWindow.loadFile(path.join(__dirname, "loading.html"))
    .then(() => {
      if (!loadingWindow || loadingWindow.isDestroyed()) return;
      loadingWindow.show();
      loadGame();
    })
    .catch(error => {
      console.error("Could not open the connection screen:", error);
      dialog.showErrorBox("ARCADE DUEL", "Impossibile aprire la schermata di avvio.");
      app.quit();
    });
}

ipcMain.on("arcade:retry", event => {
  if (!loadingWindow || event.sender !== loadingWindow.webContents || gameLoaded || isLoadingGame) return;
  retryAttempt = 0;
  loadGame();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (gameLoaded && gameWindow && !gameWindow.isDestroyed()) gameWindow.show();
  else if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.show();
  else createWindows();
});

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = gameLoaded ? gameWindow : loadingWindow;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(() => {
    registerGameProtocol();
    createWindows();
  }).catch(error => {
    console.error("Could not start ARCADE DUEL:", error);
    dialog.showErrorBox("ARCADE DUEL", "Impossibile avviare l'applicazione.");
    app.quit();
  });
}
