export class InputController {
  constructor(canvas, game, audio) {
    this.canvas = canvas;
    this.game = game;
    this.audio = audio;
    this.aimTouchId = null;
    this.touchAimStart = null;
    this.keys = new Set();
    this.bind();
  }

  setGame(game) { this.game = game; }

  bind() {
    this.canvas.addEventListener("pointermove", event => {
      if (event.pointerType === "mouse") this.updateAim(event);
    });
    this.canvas.addEventListener("pointerdown", event => {
      if (event.pointerType !== "mouse") return;
      this.audio.unlock();
      if (event.button === 2) { event.preventDefault(); this.dodge(); }
      else if (event.button === 0) this.fire();
    });
    this.canvas.addEventListener("contextmenu", event => event.preventDefault());

    window.addEventListener("keydown", event => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return;
      if (this.keys.has(event.code) || event.repeat) return;
      this.keys.add(event.code);
      if (["Space", "KeyR", "ShiftLeft", "ShiftRight", "ArrowDown", "Period", "NumpadDecimal"].includes(event.code)) event.preventDefault();
      if (event.code === "Space") this.skill();
      if (event.code === "KeyR") this.reload();
      if (["ShiftLeft", "ShiftRight", "ArrowDown", "Period", "NumpadDecimal"].includes(event.code)) this.dodge(event.code);
    });
    window.addEventListener("keyup", event => this.keys.delete(event.code));

    const aimControl = document.getElementById("aim-control");
    aimControl.addEventListener("touchstart", event => {
      if (this.aimTouchId !== null) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      event.preventDefault();
      this.aimTouchId = touch.identifier;
      this.touchAimStart = { x: touch.clientX, y: touch.clientY };
      this.updateTouchAim(touch);
    }, { passive: false });
    aimControl.addEventListener("touchmove", event => {
      const touch = this.findAimTouch(event.changedTouches);
      if (!touch) return;
      event.preventDefault();
      this.updateTouchAim(touch);
    }, { passive: false });
    const endAim = event => {
      const touch = this.findAimTouch(event.changedTouches);
      if (!touch) return;
      event.preventDefault();
      this.updateTouchAim(touch);
      this.aimTouchId = null;
      this.touchAimStart = null;
    };
    aimControl.addEventListener("touchend", endAim, { passive: false });
    aimControl.addEventListener("touchcancel", endAim, { passive: false });

    document.getElementById("fire-control").addEventListener("click", () => {
      this.audio.unlock();
      this.fire();
    });
    document.getElementById("reload-control").addEventListener("click", () => this.reload());
    document.getElementById("skill-control").addEventListener("click", () => this.skill());
    document.getElementById("dodge-control").addEventListener("click", () => this.dodge());
    document.querySelectorAll(".emote-button").forEach(button => {
      button.addEventListener("click", () => this.game.emote(button.dataset.emote));
    });
  }

  findAimTouch(touches) {
    for (let index = 0; index < touches.length; index++) {
      if (touches[index].identifier === this.aimTouchId) return touches[index];
    }
    return null;
  }

  updateAim(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.game.aimAt(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
  }

  updateTouchAim(touch) {
    if (!this.touchAimStart) return;
    this.game.aimByDrag(touch.clientX - this.touchAimStart.x, touch.clientY - this.touchAimStart.y);
  }

  fire() { this.game.fire(this.game.localSide); }
  reload() { this.game.reload(this.game.localSide); }
  skill() { this.game.skill(this.game.localSide); }

  dodge(key) {
    if (this.game.mode === "cpu" && ["ArrowDown", "Period", "NumpadDecimal"].includes(key)) return;
    this.game.dodge(this.game.localSide);
  }
}
