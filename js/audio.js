const LOBBY_NOTES = [392, 0, 523, 659, 0, 523, 440, 0, 330, 392, 0, 294];
const MAX_ACTIVE_VOICES = 10;

export class ArcadeAudio {
  constructor() {
    this.context = null;
    this.lobbyTimer = null;
    this.noteIndex = 0;
    this.unlocked = false;
    this.voices = new Set();
    const unlock = () => this.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  unlock() {
    if (this.unlocked) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    this.unlocked = true;
    if (this.context.state === "suspended") {
      this.context.resume().catch(error => console.error("Impossibile riattivare AudioContext:", error));
    }
  }

  tone(frequency, duration = 0.08, type = "square", volume = 0.06, delay = 0) {
    if (!this.context || !frequency || this.voices.size >= MAX_ACTIVE_VOICES) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const voice = { oscillator, gain };
    this.voices.add(voice);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    }, { once: true });
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  shot() { this.tone(880, 0.045); this.tone(440, 0.055, "square", 0.04, 0.055); this.tone(660, 0.035, "triangle", 0.035, 0.11); }
  hit() { this.tone(170, 0.16, "sawtooth", 0.09); this.tone(90, 0.2, "square", 0.06, 0.08); }
  dodge() { this.tone(620, 0.07, "triangle"); this.tone(980, 0.1, "triangle", 0.045, 0.06); }
  cooldown() { this.tone(180, 0.1, "square", 0.04); }

  startLobby() {
    this.stopLobby();
    this.playLobbyNote();
    this.lobbyTimer = window.setInterval(() => this.playLobbyNote(), 210);
  }

  playLobbyNote() {
    const frequency = LOBBY_NOTES[this.noteIndex++ % LOBBY_NOTES.length];
    this.tone(frequency, 0.13, "square", 0.018);
  }

  stopLobby() {
    if (this.lobbyTimer !== null) window.clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
  }

  victory() {
    [392, 494, 587, 784, 988].forEach((note, index) => this.tone(note, 0.18, "square", 0.07, index * 0.14));
  }
}
