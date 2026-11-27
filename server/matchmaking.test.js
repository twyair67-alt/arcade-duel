"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const test = require("node:test");
const WebSocket = require("ws");

async function reservePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeListener("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 5000);
    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeListener("message", onMessage);
      resolve(message);
    }
    socket.on("message", onMessage);
  });
}

async function createClient(url, nickname) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const profile = waitForMessage(socket, message => message.type === "profile");
  socket.send(JSON.stringify({ type: "hello", nickname, shipId: "viper" }));
  await profile;
  return socket;
}

test("private lobby join rejects a mismatched kind and keeps the lobby available", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-duel-matchmaking-"));
  const port = await reservePort();
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(port), ARCADE_DATA_FILE: path.join(directory, "game-data.json") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const clients = [];
  t.after(async () => {
    clients.forEach(socket => socket.close());
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timeout = setTimeout(resolve, 2000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 5000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes(`ARCADE DUEL server listening on port ${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Server exited before starting (${code}): ${output}`)));
  });

  const url = `ws://127.0.0.1:${port}`;
  const host = await createClient(url, "HST");
  clients.push(host);
  const createdLobby = waitForMessage(host, message => message.type === "private_lobby");
  host.send(JSON.stringify({ type: "create_lobby", kind: "tournament" }));
  const lobby = await createdLobby;

  const guest = await createClient(url, "GST");
  clients.push(guest);
  const mismatchedJoin = waitForMessage(guest, message => message.type === "error");
  guest.send(JSON.stringify({ type: "join_lobby", kind: "friendly", code: lobby.lobby.code }));
  assert.match((await mismatchedJoin).message, /Codice invito non valido/);

  const validJoin = waitForMessage(guest, message => message.type === "private_lobby");
  guest.send(JSON.stringify({ type: "join_lobby", kind: "tournament", code: lobby.lobby.code }));
  assert.equal((await validJoin).lobby.players.length, 2);
});
