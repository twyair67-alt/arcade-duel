"use strict";

const status = document.getElementById("connection-status");
const retryButton = document.getElementById("retry-button");

retryButton.addEventListener("click", () => window.arcadeDesktop.retry());
window.arcadeDesktop.onConnectionStatus(connection => {
  status.textContent = connection.message;
  retryButton.disabled = connection.phase === "connecting";
  retryButton.textContent = retryButton.disabled ? "ATTENDI..." : "RIPROVA ORA";
});
