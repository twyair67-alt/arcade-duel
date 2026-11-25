const STORAGE_KEY = "arcade-duel-records-v1";

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
