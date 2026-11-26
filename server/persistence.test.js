"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersistentStore } = require("./persistence.js");

function makeTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-duel-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("creates a missing data directory and atomically replaces the JSON file", t => {
  const directory = makeTempDirectory(t);
  const filePath = path.join(directory, "volume", "game-data.json");
  const store = createPersistentStore(filePath);

  store.data.profiles.first = { id: "first" };
  assert.equal(store.save(), true);
  store.data.profiles.second = { id: "second" };
  assert.equal(store.save(), true);

  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.deepEqual(Object.keys(saved.profiles).sort(), ["first", "second"]);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ["game-data.json"]);
});

test("keeps the in-memory store usable when the configured data path cannot be created", t => {
  const directory = makeTempDirectory(t);
  const blocker = path.join(directory, "not-a-directory");
  fs.writeFileSync(blocker, "block");
  const store = createPersistentStore(path.join(blocker, "game-data.json"));
  store.data.profiles.memory = { id: "memory" };

  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(store.save(), false);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(store.data.profiles.memory, { id: "memory" });
});

test("merges both legacy official leaderboard files during migration", t => {
  const directory = makeTempDirectory(t);
  const first = path.join(directory, "leaderboard.json");
  const secondDirectory = path.join(directory, "data");
  fs.mkdirSync(secondDirectory);
  const second = path.join(secondDirectory, "leaderboard.json");
  fs.writeFileSync(first, JSON.stringify({ AAA: { nickname: "AAA", wins: 1 } }));
  fs.writeFileSync(second, JSON.stringify({ BBB: { nickname: "BBB", wins: 2 } }));

  const store = createPersistentStore(path.join(directory, "game-data.json"), [first, second]);
  assert.deepEqual(Object.keys(store.data.officialRecords).sort(), ["AAA", "BBB"]);
});
