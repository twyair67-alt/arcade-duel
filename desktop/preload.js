"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arcadeDesktop", Object.freeze({
  serverUrl: "wss://arcade-duel.onrender.com",
  serverHttpUrl: "https://arcade-duel.onrender.com",
  retry: () => ipcRenderer.send("arcade:retry"),
  onConnectionStatus: callback => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("arcade:connection-status", (_event, status) => callback(status));
  }
}));
