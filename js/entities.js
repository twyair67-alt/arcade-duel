export const MAX_AMMO = 5;
export const MAX_SHIELDS = 7;

export const SHIPS = {
  viper: { id: "viper", name: "Viper", color: "#ff3b45", speed: 4, fire: 5, shield: 3, ability: "Raffica", abilityCooldown: 18 },
  aegis: { id: "aegis", name: "Aegis", color: "#35a7ff", speed: 2, fire: 3, shield: 7, ability: "Barriera Riflettente", abilityCooldown: 20 },
  phantom: { id: "phantom", name: "Phantom", color: "#bd63ff", speed: 6, fire: 4, shield: 2, ability: "Scatto Fase / Dash", abilityCooldown: 14 },
  nova: { id: "nova", name: "Nova", color: "#ffe04a", speed: 4, fire: 4, shield: 4, ability: "Impulso EMP", abilityCooldown: 18 },
  titan: { id: "titan", name: "Titan", color: "#45df79", speed: 3, fire: 4, shield: 5, ability: "Colpo Perforante", abilityCooldown: 16 }
};

export function getShip(shipId) {
  return SHIPS[shipId] || SHIPS.viper;
}

export function createPlayer(side, width, height, name, shipId = "viper") {
  const ship = getShip(shipId);
  return {
    side, name, x: side === 0 ? 42 : width - 42, y: height / 2,
    shipId: ship.id, shipName: ship.name, shipColor: ship.color,
    speedStat: ship.speed, fireStat: ship.fire, maxShield: ship.shield, shield: ship.shield,
    aim: side === 0 ? 0 : Math.PI, speed: 30 + ship.speed * 13, direction: side === 0 ? 1 : -1,
    ammo: MAX_AMMO, reloadReadyAt: 0, lastReloadAt: -10000, slowUntil: 0,
    fireReadyAt: 0, dodgeUntil: 0, cooldownUntil: 0, dodgeCount: 0, recoil: 0,
    abilityReadyAt: 0, burstShots: 0, burstNextAt: 0, reflectUntil: 0,
    dashUntil: 0, dashX: 0, dashY: 0, empUntil: 0, empAimOffset: 0,
    piercingShot: false, successfulDodges: 0
  };
}

export function clampAim(side, angle) {
  const forward = side === 0 ? 0 : Math.PI;
  let delta = Math.atan2(Math.sin(angle - forward), Math.cos(angle - forward));
  delta = Math.max(-1.05, Math.min(1.05, delta));
  return forward + delta;
}

export function movePlayer(player, dt, width, height, now, speedMultiplier = 1) {
  if (now < player.dashUntil) {
    player.x += player.dashX * 440 * dt;
    player.y += player.dashY * 440 * dt;
    return;
  }
  if (now < player.dodgeUntil) return;
  const reloadMultiplier = now < player.slowUntil ? 0.45 : 1;
  const empMultiplier = now < player.empUntil ? 0.5 : 1;
  player.y += player.direction * player.speed * speedMultiplier * reloadMultiplier * empMultiplier * dt;
  const bound = Math.max(26, height - 26);
  if (player.y < 26) { player.y = 26; player.direction = 1; }
  if (player.y > bound) { player.y = bound; player.direction = -1; }
  player.x = Math.max(26, Math.min(width - 26, player.x));
  if (now >= player.dashUntil) player.x = player.side === 0 ? Math.min(player.x, width / 2 - 20) : Math.max(player.x, width / 2 + 20);
}

export function makeBullet(player) {
  const velocity = 430;
  const trail = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
  return {
    x: player.x + Math.cos(player.aim) * 24,
    y: player.y + Math.sin(player.aim) * 24,
    vx: Math.cos(player.aim) * velocity,
    vy: Math.sin(player.aim) * velocity,
    owner: player.side,
    trail, trailIndex: 0, trailCount: 0
  };
}

export function makePickup(width, height) {
  return {
    x: width * (0.25 + Math.random() * 0.5),
    y: height * (0.2 + Math.random() * 0.6),
    vx: (Math.random() - 0.5) * 70,
    vy: (Math.random() - 0.5) * 70
  };
}
