import { createPlayer, clampAim, movePlayer, makeBullet, makePickup, MAX_AMMO, getShip } from "./entities.js";

const ROUND_SECONDS = 120;
const TRAIL_LENGTH = 6;
const MAX_PARTICLES = 64;
const SNAPSHOT_INTERVAL_MS = 40;
const AIM_SEND_INTERVAL_MS = 40;
const DASH_PATTERN = [6, 12];
const SOLID_PATTERN = [];

export class Game {
  constructor(canvas, assets, audio, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.assets = assets;
    this.audio = audio;
    this.mode = options.mode || "cpu";
    this.difficulty = options.difficulty || "medium";
    this.shipId = options.shipId || "viper";
    this.network = options.network || null;
    this.localSide = options.localSide || 0;
    this.lastAimSentAt = 0;
    this.pendingAim = null;
    this.aimFlushTimer = null;
    this.remoteInterpolation = null;
    this.viewWidth = 0;
    this.viewHeight = 0;
    this.playerName = options.playerName || "AAA";
    this.cpuName = options.cpuName || "CPU";
    this.state = null;
    this.lastTime = 0;
    this.running = false;
    this.onState = options.onState || (() => {});
    this.onResult = options.onResult || (() => {});
    this.onExit = options.onExit || (() => {});
    this.particles = [];
    this.hudElapsed = 0;
    this.frameCallback = time => this.frame(time);
    this.reset();
  }

  reset() {
    const { width, height } = this.canvas.getBoundingClientRect();
    const w = Math.max(320, width), h = Math.max(220, height);
    this.state = {
      width: w, height: h,
      obstacles: [
        { x: w * .44, y: h * .22, baseY: h * .22, width: w * .12, height: h * .1, angle: 0, phase: 0 },
        { x: w * .44, y: h * .68, baseY: h * .68, width: w * .12, height: h * .1, angle: 0, phase: Math.PI }
      ],
      players: [createPlayer(0, w, h, this.playerName, this.shipId), createPlayer(1, w, h, this.mode === "online" ? "???" : this.cpuName, "aegis")],
      bullets: [], pickup: null, round: 1, totalRounds: 3, seconds: ROUND_SECONDS,
      roundWins: [0, 0], roundDraws: 0, roundStartedAt: 0, phase: "playing", result: null,
      elapsed: 0, cpuShot: 0,
      matchStats: [{ shots: 0, hits: 0, damage: 0, reloads: 0 }, { shots: 0, hits: 0, damage: 0, reloads: 0 }],
      suddenDeath: { active: false, inset: 0, elapsed: 0 }
    };
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frameCallback);
  }

  stop() {
    this.running = false;
    if (this.aimFlushTimer !== null) window.clearTimeout(this.aimFlushTimer);
    this.aimFlushTimer = null;
    this.pendingAim = null;
  }

  resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.viewWidth = rect.width;
    this.viewHeight = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.state && this.mode !== "online") {
      const scaleX = width / (this.state.width || width);
      const scaleY = height / (this.state.height || height);
      this.state.players.forEach(p => { p.y *= scaleY; p.x = p.side === 0 ? 42 : width - 42; });
      this.state.obstacles?.forEach(obstacle => {
        obstacle.x *= scaleX; obstacle.width *= scaleX;
        obstacle.y *= scaleY; obstacle.height *= scaleY;
        if (Number.isFinite(obstacle.baseY)) obstacle.baseY *= scaleY;
      });
      this.state.width = width; this.state.height = height;
    }
  }

  frame(time) {
    if (!this.running) return;
    const dt = Math.max(0, Math.min((time - this.lastTime) / 1000, 0.05));
    this.lastTime = time;
    if (this.mode !== "online") this.update(dt);
    this.updateParticles(dt);
    this.render(time);
    this.hudElapsed += dt;
    if (this.hudElapsed >= 0.1) {
      this.hudElapsed %= 0.1;
      this.onState(this.state);
    }
    requestAnimationFrame(this.frameCallback);
  }

  aimAt(x, y, width, height) {
    const player = this.state.players[this.localSide];
    if (!player) return;
    const worldX = x * this.state.width / Math.max(width, 1);
    const worldY = y * this.state.height / Math.max(height, 1);
    const originX = player.x;
    const targetAngle = Math.atan2(worldY - player.y, worldX - originX);
    this.setAim(targetAngle);
  }

  aimByDrag(dx, dy) {
    const player = this.state.players[this.localSide];
    if (!player) return;
    const forward = player.side === 0 ? 0 : Math.PI;
    this.setAim(forward + Math.atan2(dy, Math.max(Math.abs(dx), 1)));
  }

  setAim(targetAngle) {
    const player = this.state.players[this.localSide];
    if (!player) return;
    const angle = clampAim(player.side, targetAngle);
    if (this.mode === "online") {
      this.pendingAim = angle;
      const elapsed = performance.now() - this.lastAimSentAt;
      if (elapsed >= AIM_SEND_INTERVAL_MS) this.flushAim();
      else if (this.aimFlushTimer === null) {
        this.aimFlushTimer = window.setTimeout(() => this.flushAim(), AIM_SEND_INTERVAL_MS - elapsed);
      }
    } else {
      player.aim = angle;
    }
  }

  flushAim() {
    if (this.aimFlushTimer !== null) window.clearTimeout(this.aimFlushTimer);
    this.aimFlushTimer = null;
    if (this.pendingAim === null) return;
    const angle = this.pendingAim;
    this.pendingAim = null;
    this.lastAimSentAt = performance.now();
    if (this.network?.readyState === 1) {
      this.network.send(JSON.stringify({ type: "action", action: "aim", angle }));
    }
  }

  fire(side = this.localSide) {
    if (this.mode === "online") {
      if (side === this.localSide) {
        const player = this.state.players[side];
        if (player?.ammo <= 0) { this.audio.dryFire(); return; }
        this.flushAim();
        if (this.network?.readyState === 1) this.network.send(JSON.stringify({ type: "action", action: "fire" }));
      }
      return;
    }
    const player = this.state.players[side];
    if (this.state.phase !== "playing" || !player) return;
    const now = Date.now() / 1000;
    if (player.ammo <= 0) { this.audio.dryFire(); return; }
    if (now < player.fireReadyAt) return;
    player.fireReadyAt = now + Math.max(.22, .82 - player.fireStat * .09);
    player.ammo--;
    player.recoil = 1;
    this.state.matchStats[side].shots++;
    const bullet = makeBullet(player);
    if (player.piercingShot) { bullet.piercing = true; player.piercingShot = false; }
    this.state.bullets.push(bullet);
    if (player.shipId === "viper" && player.burstShots > 0) player.burstNextAt = now + .12;
    this.audio.shot();
  }

  reload(side = this.localSide) {
    if (this.mode === "online") {
      if (side === this.localSide) {
        const player = this.state.players[side], now = Date.now() / 1000;
        const elapsed = now - (player?.lastReloadAt ?? now);
        const sweetSpot = elapsed >= 4.5 && elapsed <= 5.5;
        if (!player || player.ammo >= MAX_AMMO || (now < player.reloadReadyAt && !sweetSpot)) {
          this.audio.cooldown();
          return false;
        }
        if (this.network?.readyState === 1) this.network.send(JSON.stringify({ type: "action", action: "reload" }));
      }
      return false;
    }
    const player = this.state.players[side];
    if (this.state.phase !== "playing" || !player) return false;
    const now = Date.now() / 1000;
    const elapsed = now - player.lastReloadAt;
    const sweetSpot = elapsed >= 4.5 && elapsed <= 5.5;
    if (player.ammo >= MAX_AMMO || (now < player.reloadReadyAt && !sweetSpot)) {
      this.audio.cooldown();
      return false;
    }
    player.ammo = Math.min(MAX_AMMO, player.ammo + 2);
    player.lastReloadAt = now;
    player.reloadReadyAt = now + 10;
    player.slowUntil = now + (sweetSpot ? .25 : .5);
    this.state.matchStats[side].reloads++;
    this.audio.reload();
    return sweetSpot;
  }

  skill(side = this.localSide) {
    const player = this.state.players[side];
    if (this.mode === "online") {
      if (side === this.localSide && this.network?.readyState === 1) {
        const now = Date.now() / 1000;
        if (!player || now < player.abilityReadyAt) { this.audio.cooldown(); return false; }
        if (player.shipId === "viper" && player.ammo <= 0) { this.audio.dryFire(); return false; }
        this.network.send(JSON.stringify({ type: "action", action: "skill", shipId: player?.shipId }));
      }
      return false;
    }
    if (this.state.phase !== "playing" || !player) return false;
    const now = Date.now() / 1000;
    const ship = getShip(player.shipId);
    if (now < player.abilityReadyAt) { this.audio.cooldown(); return false; }
    if (player.shipId === "viper" && player.ammo <= 0) { this.audio.dryFire(); return false; }
    player.abilityReadyAt = now + ship.abilityCooldown;
    if (player.shipId === "viper") {
      player.ammo--;
      player.burstShots = 3;
      player.burstNextAt = now;
      player.recoil = 1;
    } else if (player.shipId === "aegis") {
      player.reflectUntil = now + 1.5;
    } else if (player.shipId === "phantom") {
      player.dashX = Math.cos(player.aim);
      player.dashY = Math.sin(player.aim);
      player.dashUntil = now + .25;
    } else if (player.shipId === "nova") {
      const enemy = this.state.players[1 - side];
      enemy.empUntil = now + 1.5;
    } else if (player.shipId === "titan") {
      player.piercingShot = true;
    }
    this.audio.dodge();
    return true;
  }

  emote(emote) {
    if (!["gg", "nice", "oops", "rematch"].includes(emote)) return;
    if (this.mode === "online" && this.network?.readyState === 1) {
      this.network.send(JSON.stringify({ type: "action", action: "emote", emote }));
    } else {
      this.state.emote = { side: this.localSide, text: this.emoteLabel(emote), until: Date.now() / 1000 + 1.5 };
    }
  }

  applyEmote(side, emote) {
    if (!["gg", "nice", "oops", "rematch"].includes(emote)) return;
    this.state.emote = { side, text: this.emoteLabel(emote), until: Date.now() / 1000 + 1.5 };
  }

  emoteLabel(emote) {
    return { gg: "GG", nice: "BELLA MOSSA!", oops: "OPS!", rematch: "RIVINCITA?" }[emote];
  }

  dodge(side = this.localSide) {
    if (this.mode === "online") {
      if (side === this.localSide) {
        const player = this.state.players[side];
        if (player && Date.now() / 1000 < player.cooldownUntil) this.audio.cooldown();
        else this.audio.dodge();
        if (this.network?.readyState === 1) this.network.send(JSON.stringify({ type: "action", action: "dodge" }));
      }
      return;
    }
    const player = this.state.players[side], now = Date.now() / 1000;
    if (this.state.phase !== "playing" || !player || now < player.cooldownUntil) {
      if (player) this.audio.cooldown();
      return;
    }
    player.dodgeUntil = now + 0.4;
    player.cooldownUntil = now + 10.4;
    player.dodgeCount++;
    this.audio.dodge();
  }

  update(dt) {
    const s = this.state;
    if (s.phase !== "playing") return;
    const now = Date.now() / 1000;
    s.elapsed += dt;
    s.seconds = Math.max(0, ROUND_SECONDS - s.elapsed);
    const suddenElapsed = Math.max(0, s.elapsed - 90);
    s.suddenDeath = { active: s.elapsed >= 90, elapsed: suddenElapsed, inset: Math.min(180, suddenElapsed * 3) };
    for (const obstacle of s.obstacles || []) obstacle.y = obstacle.baseY + Math.sin(s.elapsed * .75 + obstacle.phase) * 34;
    for (let index = 0; index < s.players.length; index++) {
      const p = s.players[index];
      movePlayer(p, dt, s.width, s.height, now, 1 + s.elapsed * 0.018);
      if (s.suddenDeath.active) {
        const inset = s.suddenDeath.inset;
        const inDanger = p.x < 26 + inset || p.x > s.width - 26 - inset ||
          p.y < 26 + inset || p.y > s.height - 26 - inset;
        p.dangerElapsed = inDanger ? (p.dangerElapsed || 0) + dt : 0;
        if (p.dangerElapsed >= 1) {
          p.dangerElapsed -= 1;
          p.shield = Math.max(0, p.shield - 1);
          if (p.shield <= 0) return this.finishRound(1 - p.side);
        }
      } else p.dangerElapsed = 0;
      p.recoil = Math.max(0, p.recoil - dt * 5);
      if (p.burstShots > 0 && now >= p.burstNextAt) {
        s.bullets.push(makeBullet(p));
        p.burstShots--;
        p.burstNextAt = now + .12;
        s.matchStats[p.side].shots++;
        this.audio.shot();
      }
    }
    if (this.mode === "cpu" || this.mode === "training") this.updateCpu(dt, now);
    this.updateBullets(dt, now);
    if (s.players[0].ammo === 0 && s.players[1].ammo === 0 && !s.pickup) s.pickup = makePickup(s.width, s.height);
    this.updatePickup(dt);
    if (s.seconds <= 0) this.finishRound(null);
  }

  updateCpu(dt, now) {
    const cpu = this.state.players[1], human = this.state.players[0];
    const settings = {
      easy: { shotDelay: 1.7, aimError: .2, dodgeChance: 1.2, moveRate: .4 },
      medium: { shotDelay: 1.15, aimError: .1, dodgeChance: 2, moveRate: .8 },
      hard: { shotDelay: .7, aimError: .025, dodgeChance: 3.2, moveRate: 1.25 }
    }[this.difficulty] || { shotDelay: 1.15, aimError: .1, dodgeChance: 2, moveRate: .8 };
    let incoming = false;
    for (let index = 0; index < this.state.bullets.length; index++) {
      const bullet = this.state.bullets[index];
      if (bullet.owner === 0 && Math.abs(bullet.x - cpu.x) < 160 && Math.abs(bullet.y - cpu.y) < 50) {
        incoming = true;
        break;
      }
    }
    if (incoming && now >= cpu.cooldownUntil && Math.random() < dt * settings.dodgeChance) this.dodge(1);
    if (incoming && now >= cpu.abilityReadyAt && Math.random() < dt * settings.dodgeChance * .4) this.skill(1);
    if (cpu.ammo <= 2 && now >= cpu.reloadReadyAt) this.reload(1);
    const disruption = now < cpu.empUntil ? settings.aimError * 5 : settings.aimError;
    cpu.aim = clampAim(1, Math.atan2(human.y - cpu.y, human.x - cpu.x) + (Math.random() - .5) * disruption);
    cpu.cpuShot -= dt;
    if (cpu.cpuShot <= 0 && cpu.ammo > 0) {
      cpu.cpuShot = settings.shotDelay + Math.random() * .6;
      const targetY = this.cpuShotY(cpu, human);
      cpu.aim = clampAim(1, Math.atan2(targetY - cpu.y, human.x - cpu.x) + (Math.random() - .5) * disruption);
      this.fire(1);
    }
    if (Math.abs(cpu.y - human.y) < 70 && Math.random() < dt * settings.moveRate) cpu.direction *= -1;
    if (this.state.pickup && cpu.ammo < MAX_AMMO && Math.random() < dt * 0.25) {
      cpu.aim = clampAim(1, Math.atan2(this.state.pickup.y - cpu.y, this.state.pickup.x - cpu.x));
    }
  }

  cpuShotY(cpu, human) {
    const s = this.state;
    for (const obstacle of s.obstacles || []) {
      const crossingX = obstacle.x + obstacle.width / 2;
      const ratio = (crossingX - cpu.x) / (human.x - cpu.x);
      const crossingY = cpu.y + (human.y - cpu.y) * ratio;
      if (crossingY >= obstacle.y - 8 && crossingY <= obstacle.y + obstacle.height + 8) {
        const openingY = crossingY - obstacle.y < obstacle.height / 2
          ? obstacle.y - 10
          : obstacle.y + obstacle.height + 10;
        return cpu.y + (openingY - cpu.y) / ratio;
      }
    }
    return human.y;
  }

  updateBullets(dt, now) {
    const s = this.state;
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const bullet = s.bullets[i];
      const trailPoint = bullet.trail[bullet.trailIndex];
      trailPoint.x = bullet.x;
      trailPoint.y = bullet.y;
      bullet.trailIndex = (bullet.trailIndex + 1) % TRAIL_LENGTH;
      bullet.trailCount = Math.min(TRAIL_LENGTH, bullet.trailCount + 1);
      bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt;
      const obstacle = (s.obstacles || []).find(item =>
        bullet.x >= item.x && bullet.x <= item.x + item.width &&
        bullet.y >= item.y && bullet.y <= item.y + item.height
      );
      if (obstacle) {
        if (bullet.piercing && !bullet.piercingObstacle) bullet.piercingObstacle = obstacle;
        else if (bullet.piercingObstacle !== obstacle) { s.bullets.splice(i, 1); continue; }
      } else if (bullet.piercingObstacle) {
        bullet.piercing = false;
        bullet.piercingObstacle = null;
      }
      const target = s.players[1 - bullet.owner];
      if (Math.hypot(target.x - bullet.x, target.y - bullet.y) < 17) {
        const nowSeconds = now;
        if (nowSeconds < target.reflectUntil && !bullet.reflected) {
          bullet.owner = target.side;
          bullet.vx = -bullet.vx;
          bullet.vy = -bullet.vy;
          bullet.reflected = true;
          bullet.x += bullet.vx * .04;
          continue;
        }
        s.bullets.splice(i, 1);
        if (now < target.dodgeUntil) {
          target.successfulDodges = (target.successfulDodges || 0) + 1;
          if (target.ammo === 0 && target.successfulDodges % 3 === 0) target.ammo = Math.min(MAX_AMMO, target.ammo + 2);
          continue;
        }
        s.matchStats[bullet.owner].hits++;
        s.matchStats[bullet.owner].damage++;
        this.audio.hit();
        target.shield = Math.max(0, target.shield - 1);
        if (target.shield <= 0) {
          this.burst(bullet.x, bullet.y);
          this.audio.hit();
          this.finishRound(bullet.owner);
          return;
        }
      }
      if (bullet.x < -20 || bullet.x > s.width + 20 || bullet.y < -20 || bullet.y > s.height + 20) s.bullets.splice(i, 1);
    }
  }

  updatePickup(dt) {
    const s = this.state;
    if (!s.pickup) return;
    const p = s.pickup;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < 12 || p.x > s.width - 12) p.vx *= -1;
    if (p.y < 12 || p.y > s.height - 12) p.vy *= -1;
    for (let index = 0; index < s.players.length; index++) {
      const player = s.players[index];
      if (player.ammo < MAX_AMMO && Math.hypot(player.x - p.x, player.y - p.y) < 28) {
        player.ammo++; s.pickup = null;
      }
    }
  }

  finishRound(winner) {
    const s = this.state;
    if (s.phase !== "playing") return;
    if (winner === 0 || winner === 1) s.roundWins[winner]++;
    else s.roundDraws++;
    s.phase = "roundEnd";
    s.roundWinner = winner;
    this.onState(s);
  }

  nextRound() {
    const s = this.state;
    if (s.round >= 3 && s.roundWins[0] !== s.roundWins[1]) return this.finishMatch(s.roundWins[0] > s.roundWins[1] ? 0 : 1);
    if (s.round === 3 && s.roundWins[0] === s.roundWins[1]) s.totalRounds = 4;
    if (s.round === 4) return this.finishMatch(s.roundWins[0] === s.roundWins[1] ? null : s.roundWins[0] > s.roundWins[1] ? 0 : 1);
    s.round++;
    this.resetRound();
  }

  resetRound() {
    const s = this.state, width = s.width, height = s.height;
    s.players = s.players.map((old, i) => createPlayer(i, width, height, old.name, old.shipId));
    s.obstacles = [
      { x: width * .44, y: height * .22, baseY: height * .22, width: width * .12, height: height * .1, angle: 0, phase: 0 },
      { x: width * .44, y: height * .68, baseY: height * .68, width: width * .12, height: height * .1, angle: 0, phase: Math.PI }
    ];
    s.bullets = []; s.pickup = null; s.seconds = ROUND_SECONDS; s.elapsed = 0; s.phase = "playing";
    s.suddenDeath = { active: false, inset: 0, elapsed: 0 };
  }

  finishMatch(winner) {
    this.state.phase = "matchEnd";
    this.state.matchWinner = winner;
    this.onResult(
      winner === null ? "draw" : winner === this.localSide ? "win" : "loss",
      this.state.matchStats?.[this.localSide]
    );
  }

  applyNetworkState(state) {
    const previous = this.state;
    const now = performance.now();
    const remote = state.players?.[1 - this.localSide];
    if (remote) {
      const interpolation = this.remoteInterpolation;
      if (!interpolation || previous?.round !== state.round || previous?.phase !== "playing" || state.phase !== "playing") {
        this.remoteInterpolation = {
          fromX: remote.x, fromY: remote.y, fromAim: remote.aim,
          toX: remote.x, toY: remote.y, toAim: remote.aim,
          x: remote.x, y: remote.y, aim: remote.aim,
          receivedAt: now, lastSnapshotAt: now, duration: SNAPSHOT_INTERVAL_MS
        };
      } else {
        this.sampleRemote(now);
        interpolation.fromX = interpolation.x;
        interpolation.fromY = interpolation.y;
        interpolation.fromAim = interpolation.aim;
        interpolation.toX = remote.x;
        interpolation.toY = remote.y;
        interpolation.toAim = remote.aim;
        interpolation.duration = Math.max(16, now - interpolation.lastSnapshotAt);
        interpolation.receivedAt = now;
        interpolation.lastSnapshotAt = now;
      }
    }
    this.state = state;
    if (previous?.players && state.players) {
      state.players.forEach((player, index) => {
        if (player.ammo < (previous.players[index]?.ammo ?? player.ammo)) this.audio.shot();
      });
    }
    if (previous?.phase === "playing" && state.phase === "roundEnd") this.audio.hit();
    this.onState(state);
    if (state.phase === "matchEnd")     this.onResult(state.result || "draw", state.matchStats?.[this.localSide]);
  }

  applyNetworkMessage(message) {
    if (message.type === "state") this.applyNetworkState(message.state);
    else if (message.type === "round_end") {
      this.applyNetworkState(message.state);
      this.state.phase = "roundEnd";
      this.state.roundWinner = message.winner;
    } else if (message.type === "match_end") {
      this.state = message.state;
      this.state.phase = "matchEnd";
      this.state.result = message.result;
      this.onState(this.state);
      this.onResult(message.result, message.stats, message.profile, message.rankDelta);
    }
  }

  burst(x, y) {
    for (let i = 0; i < 16 && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({ x, y, vx: (Math.random() - .5) * 200, vy: (Math.random() - .5) * 200, life: .45 });
    }
  }

  sampleRemote(time) {
    const interpolation = this.remoteInterpolation;
    if (!interpolation) return;
    const alpha = Math.min(1, Math.max(0, (time - interpolation.receivedAt) / interpolation.duration));
    const delta = Math.atan2(Math.sin(interpolation.toAim - interpolation.fromAim), Math.cos(interpolation.toAim - interpolation.fromAim));
    interpolation.x = interpolation.fromX + (interpolation.toX - interpolation.fromX) * alpha;
    interpolation.y = interpolation.fromY + (interpolation.toY - interpolation.fromY) * alpha;
    interpolation.aim = interpolation.fromAim + delta * alpha;
  }

  updateParticles(dt) {
    let writeIndex = 0;
    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
      if (particle.life <= 0) continue;
      this.particles[writeIndex++] = particle;
    }
    this.particles.length = writeIndex;
  }

  render(time = performance.now()) {
    const s = this.state, ctx = this.ctx;
    if (!s || !ctx) return;
    const width = this.viewWidth, height = this.viewHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.scale(width / s.width, height / s.height);
    const worldWidth = s.width, worldHeight = s.height;
    ctx.setLineDash(DASH_PATTERN); ctx.strokeStyle = "#28333b"; ctx.beginPath(); ctx.moveTo(worldWidth / 2, 0); ctx.lineTo(worldWidth / 2, worldHeight); ctx.stroke(); ctx.setLineDash(SOLID_PATTERN);
    for (const obstacle of s.obstacles || []) {
      ctx.fillStyle = "#26333b"; ctx.strokeStyle = "#56636b";
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      ctx.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    }
    if (s.suddenDeath?.active) {
      ctx.fillStyle = "#ff163322";
      const inset = s.suddenDeath.inset;
      ctx.fillRect(0, 0, worldWidth, inset);
      ctx.fillRect(0, worldHeight - inset, worldWidth, inset);
      ctx.fillRect(0, inset, inset, worldHeight - inset * 2);
      ctx.fillRect(worldWidth - inset, inset, inset, worldHeight - inset * 2);
      ctx.strokeStyle = "#ff4055"; ctx.lineWidth = 2;
      ctx.strokeRect(inset, inset, worldWidth - inset * 2, worldHeight - inset * 2);
    }

    for (let bulletIndex = 0; bulletIndex < (s.bullets || []).length; bulletIndex++) {
      const bullet = s.bullets[bulletIndex];
      const trailCount = Math.min(bullet.trailCount || 0, bullet.trail?.length || 0);
      for (let index = 0; index < trailCount; index++) {
        const trailIndex = (bullet.trailIndex - 1 - index + TRAIL_LENGTH) % TRAIL_LENGTH;
        const point = bullet.trail[trailIndex];
        ctx.globalAlpha = 1 - index / 8;
        ctx.fillStyle = bullet.owner === 0 ? "#31f5ff" : "#ff3fa4";
        ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.shadowColor = "#fff"; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    if (s.pickup) {
      ctx.save(); ctx.translate(s.pickup.x, s.pickup.y); ctx.rotate(time / 700);
      ctx.fillStyle = "#fff"; ctx.shadowColor = "#fff"; ctx.shadowBlur = 12; ctx.fillRect(-7, -7, 14, 14); ctx.restore(); ctx.shadowBlur = 0;
    }
    if (this.mode === "online") {
      this.sampleRemote(time);
      const remote = s.players[1 - this.localSide];
      if (remote && this.remoteInterpolation) {
        remote.x = this.remoteInterpolation.x;
        remote.y = this.remoteInterpolation.y;
        remote.aim = this.remoteInterpolation.aim;
      }
    }
    for (let side = 0; side < (s.players || []).length; side++) {
      const player = s.players[side];
      const left = side === 0 ? "left" : "right";
      const color = player.shipColor || (player.side === 0 ? "#31f5ff" : "#ff3fa4");
      ctx.strokeStyle = color;
      ctx.globalAlpha = .75; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(player.x + Math.cos(player.aim) * 18, player.y + Math.sin(player.aim) * 18); ctx.lineTo(player.x + Math.cos(player.aim) * 105, player.y + Math.sin(player.aim) * 105); ctx.stroke(); ctx.setLineDash(SOLID_PATTERN); ctx.globalAlpha = 1;
      if (Date.now() / 1000 < player.reflectUntil) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(player.x, player.y, 23, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
      }
      if (Date.now() / 1000 < player.slowUntil) {
        ctx.fillStyle = "#a0cfff"; ctx.globalAlpha = .65; ctx.beginPath(); ctx.arc(player.x, player.y, 27, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
      if (Date.now() / 1000 < player.dodgeUntil) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(player.x, player.y, 20, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
      }
      this.assets.drawWeapon(ctx, player, left);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(player.x, player.y, 3, 0, Math.PI * 2); ctx.fill();
      if (player.shield < player.maxShield) {
        ctx.strokeStyle = color; ctx.globalAlpha = .35 + .45 * player.shield / player.maxShield; ctx.beginPath(); ctx.arc(player.x, player.y, 18 + player.shield, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (s.emote?.side === side && Date.now() / 1000 < s.emote.until) {
        ctx.fillStyle = "#fff"; ctx.font = "bold 16px monospace"; ctx.textAlign = "center";
        ctx.fillText(s.emote.text, player.x, player.y - 32);
      }
    }
    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index];
      ctx.globalAlpha = Math.max(0, particle.life / .45);
      ctx.fillStyle = "#fff";
      ctx.fillRect(particle.x, particle.y, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
