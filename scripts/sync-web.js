"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const targetDirectories = {
  android: path.join(projectRoot, "android-app", "www"),
  desktop: path.join(projectRoot, "desktop", "game")
};
const platform = process.argv[2];
const targetDirectory = targetDirectories[platform];

if (!targetDirectory) {
  throw new Error("Specify a target platform: android or desktop.");
}

const webEntries = ["index.html", "style.css", "js", "assets"];
for (const entry of webEntries) {
  if (!fs.existsSync(path.join(projectRoot, entry))) {
    throw new Error(`Missing web source: ${entry}`);
  }
}

fs.rmSync(targetDirectory, { recursive: true, force: true });
fs.mkdirSync(targetDirectory, { recursive: true });
for (const entry of webEntries) {
  fs.cpSync(path.join(projectRoot, entry), path.join(targetDirectory, entry), { recursive: true });
}

if (platform === "android") {
  const indexPath = path.join(targetDirectory, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const configuration = '<script>window.ARCADE_SERVER_URL = "wss://arcade-duel.onrender.com"; window.ARCADE_SERVER_HTTP = "https://arcade-duel.onrender.com";</script>';
  if (!html.includes("</head>")) {
    throw new Error("Cannot configure the Android client: index.html has no closing head tag.");
  }
  fs.writeFileSync(indexPath, html.replace("</head>", `${configuration}\n</head>`));
}

console.log(`Synchronized ${webEntries.join(", ")} from the project root to ${targetDirectory}.`);
