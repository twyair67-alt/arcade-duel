"use strict";

const GAME_URL = "https://arcade-duel.onrender.com/";
const RETRY_DELAYS_MS = [3000, 7000, 15000, 30000, 45000, 60000];
const RETRY_ATTEMPT_KEY = "arcade-duel-render-retry-attempt";
const status = document.getElementById("status");
const retryButton = document.getElementById("retry");
let retryAttempt = 0;
let retryTimer = null;
let countdownTimer = null;

function openGame() {
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
  retryButton.disabled = true;
  retryButton.textContent = "CONNESSIONE...";
  status.textContent = "Tentativo di connessione a Render. Attendi, il server potrebbe essere in riavvio...";
  window.location.replace(GAME_URL);
}

function queueRetry() {
  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
  retryAttempt += 1;
  sessionStorage.setItem(RETRY_ATTEMPT_KEY, String(retryAttempt));
  let remaining = Math.ceil(delay / 1000);
  status.textContent = `Server temporaneamente non raggiungibile. Nuovo tentativo tra ${remaining} secondi.`;
  retryButton.disabled = false;
  retryButton.textContent = "RIPROVA ORA";
  countdownTimer = window.setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      status.textContent = `Server temporaneamente non raggiungibile. Nuovo tentativo tra ${remaining} secondi.`;
    } else {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }, 1000);
  retryTimer = window.setTimeout(openGame, delay);
}

retryButton.addEventListener("click", openGame);
window.addEventListener("pageshow", () => {
  const storedAttempt = Number(sessionStorage.getItem(RETRY_ATTEMPT_KEY));
  retryAttempt = Number.isSafeInteger(storedAttempt) && storedAttempt > 0 ? storedAttempt : 0;
  queueRetry();
});
