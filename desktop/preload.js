"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arcadeDesktop", Object.freeze({
  retry: () => ipcRenderer.send("arcade:retry"),
  onConnectionStatus: callback => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("arcade:connection-status", (_event, status) => callback(status));
  }
}));
