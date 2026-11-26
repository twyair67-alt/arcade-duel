"use strict";

const fs = require("node:fs");
const path = require("node:path");

function emptyData() {
  return {
    profiles: {},
    officialRecords: {},
    cpuRecords: { easy: {}, medium: {}, hard: {} },
    cpuEvents: []
  };
}

function readLegacyFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Could not read legacy data ${filePath}:`, error.message);
    return null;
  }
}

function createPersistentStore(filePath, legacyPaths = []) {
  let data = emptyData();
  try {
    if (fs.existsSync(filePath)) {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("data must be a JSON object");
      data = {
        ...emptyData(),
        ...saved,
        profiles: saved.profiles && typeof saved.profiles === "object" ? saved.profiles : {},
        officialRecords: saved.officialRecords && typeof saved.officialRecords === "object" ? saved.officialRecords : {},
        cpuRecords: {
          ...emptyData().cpuRecords,
          ...(saved.cpuRecords && typeof saved.cpuRecords === "object" ? saved.cpuRecords : {})
        },
        cpuEvents: Array.isArray(saved.cpuEvents) ? saved.cpuEvents.filter(id => typeof id === "string").slice(-5000) : []
      };
    } else {
      for (const legacyPath of legacyPaths) {
        const legacy = readLegacyFile(legacyPath);
        if (!legacy) continue;
        if (legacyPath.includes("cpu")) {
          const records = legacy.records && typeof legacy.records === "object" ? legacy.records : {};
          for (const record of Object.values(records)) {
            const level = record?.difficulty;
            if (data.cpuRecords[level]) data.cpuRecords[level][record.profileId || record.nickname || "legacy"] = record;
          }
          if (Array.isArray(legacy.eventIds)) data.cpuEvents.push(...legacy.eventIds);
        } else {
          if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
            data.officialRecords = { ...data.officialRecords, ...legacy };
          }
        }
      }
    }
  } catch (error) {
    console.error(`Could not load persisted game data; using memory storage: ${error.message}`);
    data = emptyData();
  }

  function save() {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporaryPath, filePath);
      return true;
    } catch (error) {
      console.error(`Could not persist game data; changes remain in memory: ${error.message}`);
      try {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      } catch (cleanupError) {
        console.error(`Could not clean temporary persistence file: ${cleanupError.message}`);
      }
      return false;
    }
  }

  return {
    get data() { return data; },
    save
  };
}

module.exports = { createPersistentStore };
