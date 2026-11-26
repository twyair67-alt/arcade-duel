const STORAGE_KEY = "arcade-duel-records-v1";
const CPU_STORAGE_KEY = "arcade-duel-cpu-records-v1";
const CPU_QUEUE_KEY = "arcade-duel-cpu-sync-queue-v1";
const CPU_DIFFICULTIES = ["easy", "medium", "hard"];

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value === null ? fallback : value;
  } catch (error) {
    console.error(`Impossibile leggere ${key}:`, error);
    return fallback;
  }
}

function sanitizeRecord(record) {
  return {
    nickname: String(record.nickname || "AAA").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "A"),
    wins: Math.max(0, Number(record.wins) || 0),
    losses: Math.max(0, Number(record.losses) || 0),
    draws: Math.max(0, Number(record.draws) || 0)
  };
}

export class Leaderboard {
  getLocal() {
    try {
      const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(records) ? records.map(sanitizeRecord) : [];
    } catch (error) {
      console.error("Impossibile leggere la classifica locale:", error);
      return [];
    }
  }

  recordLocal(nickname, result) {
    const records = this.getLocal();
    let record = records.find(item => item.nickname === nickname);
    if (!record) { record = sanitizeRecord({ nickname }); records.push(record); }
    if (result === "win") record.wins++;
    else if (result === "loss") record.losses++;
    else if (result === "draw") record.draws++;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
    catch (error) { console.error("Impossibile salvare la classifica locale:", error); }
  }

  render(records) {
    if (!records.length) return '<p class="empty-board">NESSUN RECORD ANCORA</p>';
    const sorted = records.map(sanitizeRecord).sort((a, b) =>
      (b.wins * 3 + b.draws) - (a.wins * 3 + a.draws) || b.wins - a.wins || a.nickname.localeCompare(b.nickname)
    );
    return `<table class="leaderboard-table"><thead><tr><th>#</th><th>NICK</th><th>W</th><th>L</th><th>D</th><th>W-L-D</th><th>PUNTI</th></tr></thead><tbody>${sorted.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${r.nickname}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td>${r.wins}-${r.losses}-${r.draws}</td><td>${r.wins * 3 + r.draws}</td></tr>`
    ).join("")}</tbody></table>`;
  }
}

export class CpuLeaderboard {
  getLocal() {
    const saved = readJson(CPU_STORAGE_KEY, {});
    return Object.fromEntries(CPU_DIFFICULTIES.map(difficulty => {
      const record = saved && saved[difficulty] && typeof saved[difficulty] === "object" ? saved[difficulty] : {};
      return [difficulty, {
        xp: Math.max(0, Number(record.xp) || 0),
        wins: Math.max(0, Number(record.wins) || 0),
        losses: Math.max(0, Number(record.losses) || 0),
        draws: Math.max(0, Number(record.draws) || 0),
        bestRoundWins: Math.max(0, Number(record.bestRoundWins) || 0)
      }];
    }));
  }

  recordMatch(nickname, difficulty, result, roundWins, profile) {
    if (!CPU_DIFFICULTIES.includes(difficulty)) throw new Error(`Difficoltà CPU non valida: ${difficulty}`);
    const records = this.getLocal();
    const record = records[difficulty];
    if (result === "win") {
      record.wins++;
      record.xp += { easy: 15, medium: 30, hard: 55 }[difficulty];
    } else if (result === "loss") record.losses++;
    else record.draws++;
    record.bestRoundWins = Math.max(record.bestRoundWins, Number(roundWins) || 0);
    localStorage.setItem(CPU_STORAGE_KEY, JSON.stringify(records));

    const queue = readJson(CPU_QUEUE_KEY, []);
    queue.push({
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      profileId: profile?.id || null,
      nickname: String(nickname || "AAA").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "A"),
      difficulty, result, xp: result === "win" ? { easy: 15, medium: 30, hard: 55 }[difficulty] : 0,
      roundWins: Number(roundWins) || 0, createdAt: new Date().toISOString()
    });
    localStorage.setItem(CPU_QUEUE_KEY, JSON.stringify(queue));
  }

  async sync(profile) {
    if (!navigator.onLine || !profile?.id || !profile?.accessToken) return;
    const queue = readJson(CPU_QUEUE_KEY, []);
    if (!Array.isArray(queue) || !queue.length) return;
    const endpoint = `${getHttpBase()}/api/cpu-records`;
    const remaining = [];
    for (const queuedEntry of queue) {
      const entry = {
        ...queuedEntry,
        profileId: queuedEntry.profileId || profile.id
      };
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${profile.accessToken}`
          },
          body: JSON.stringify(entry)
        });
        if (!response.ok) throw new Error(`Server classifica CPU: HTTP ${response.status}`);
      } catch (error) {
        console.error("Sincronizzazione classifica CPU non riuscita:", error);
        remaining.push(entry);
      }
    }
    localStorage.setItem(CPU_QUEUE_KEY, JSON.stringify(remaining));
  }

  async getGlobal() {
    const response = await fetch(`${getHttpBase()}/api/cpu-leaderboard`);
    if (!response.ok) throw new Error(`Classifica CPU: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.records)) throw new Error("Risposta classifica CPU non valida");
    return body.records;
  }

  renderLocal(records) {
    const names = { easy: "CPU SEMPLICE", medium: "CPU MEDIA", hard: "CPU DIFFICILE" };
    return `<div class="cpu-records">${CPU_DIFFICULTIES.map(level => {
      const r = records[level];
      return `<section class="cpu-record"><h3>${names[level]}</h3><p>${r.xp} XP CPU · ${r.wins} V · ${r.losses} S · ${r.draws} P</p></section>`;
    }).join("")}</div>`;
  }

  renderGlobal(records) {
    const names = { easy: "CPU SEMPLICE", medium: "CPU MEDIA", hard: "CPU DIFFICILE" };
    const sections = CPU_DIFFICULTIES.map(difficulty => {
      const sorted = records.filter(record => record.difficulty === difficulty)
        .sort((a, b) => b.xp - a.xp || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
      if (!sorted.length) return `<section class="cpu-record"><h3>${names[difficulty]}</h3><p>NESSUN RECORD ANCORA</p></section>`;
      return `<section class="cpu-record"><h3>${names[difficulty]}</h3><table class="leaderboard-table"><thead><tr><th>#</th><th>NICK</th><th>V</th><th>XP CPU</th></tr></thead><tbody>${sorted.map((r, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(r.nickname)}</td><td>${r.wins}</td><td>${r.xp}</td></tr>`
      ).join("")}</tbody></table></section>`;
    });
    return `<div class="cpu-records">${sections.join("")}</div>`;
  }
}

function getHttpBase() {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const fallback = location.protocol === "file:" || !location.host || localHost
    ? `http://${location.hostname || "localhost"}:8080`
    : location.origin;
  return (window.ARCADE_SERVER_HTTP || fallback).replace(/\/$/, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

export async function fetchGlobalLeaderboard() {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const fallback = location.protocol === "file:" || !location.host || localHost
    ? `http://${location.hostname || "localhost"}:8080`
    : location.origin;
  const configured = window.ARCADE_SERVER_HTTP || fallback;
  const response = await fetch(`${configured.replace(/\/$/, "")}/api/leaderboard`);
  if (!response.ok) throw new Error(`Server classifica: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.records)) throw new Error("Risposta classifica non valida");
  return body.records;
}
