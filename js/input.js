export class InputController {
  constructor(canvas, game, audio) {
    this.canvas = canvas;
    this.game = game;
    this.audio = audio;
    this.pointerDown = false;
    this.touchAimStart = null;
    this.keys = new Set();
    this.bind();
  }

  setGame(game) { this.game = game; }

  bind() {
    this.canvas.addEventListener("pointermove", event => this.updateAim(event));
    this.canvas.addEventListener("pointerdown", event => {
      this.audio.unlock();
      if (event.button === 2) { event.preventDefault(); this.dodge(); }
      else if (event.pointerType === "mouse") this.fire();
    });
    this.canvas.addEventListener("contextmenu", event => event.preventDefault());
    window.addEventListener("keydown", event => {
      if (this.keys.has(event.code)) return;
      this.keys.add(event.code);
      if (["Space", "Enter", "Numpad0", "ShiftLeft", "ShiftRight", "ArrowDown", "Period", "NumpadDecimal"].includes(event.code)) event.preventDefault();
      if (["Space", "Enter", "Numpad0"].includes(event.code)) this.fire(event.code);
      if (["ShiftLeft", "ShiftRight", "ArrowDown", "Period", "NumpadDecimal"].includes(event.code)) this.dodge(event.code);
    });
    window.addEventListener("keyup", event => this.keys.delete(event.code));

    const fireButton = document.getElementById("fire-control");
    fireButton.addEventListener("pointerdown", event => {
      event.preventDefault();
      this.audio.unlock();
      this.pointerDown = true;
      this.touchAimStart = { x: event.clientX, y: event.clientY };
      fireButton.setPointerCapture(event.pointerId);
      this.updateTouchAim(event);
    });
    fireButton.addEventListener("pointermove", event => { if (this.pointerDown) this.updateTouchAim(event); });
    const release = event => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      this.touchAimStart = null;
      this.fire();
    };
    fireButton.addEventListener("pointerup", release);
    fireButton.addEventListener("pointercancel", release);
    document.getElementById("dodge-control").addEventListener("click", () => this.dodge());
  }

  updateAim(event) {
    const rect = this.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.game.aimAt(point.x, point.y, rect.width, rect.height);
  }

  updateTouchAim(event) {
    if (!this.touchAimStart) return;
    this.game.aimByDrag(event.clientX - this.touchAimStart.x, event.clientY - this.touchAimStart.y);
  }

  fire(key) {
    if (this.game.mode === "cpu" && ["Enter", "Numpad0"].includes(key)) return;
    this.game.fire(this.game.localSide);
  }

  dodge(key) {
    if (this.game.mode === "cpu" && ["ArrowDown", "Period", "NumpadDecimal"].includes(key)) return;
    this.game.dodge(this.game.localSide);
  }
}
