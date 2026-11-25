export const MAX_AMMO = 5;

export function createPlayer(side, width, height, name) {
  return {
    side, name, x: side === 0 ? 42 : width - 42, y: height / 2,
    aim: side === 0 ? 0 : Math.PI, speed: 85, direction: side === 0 ? 1 : -1,
    ammo: 3, dodgeUntil: 0, cooldownUntil: 0, dodgeCount: 0, recoil: 0
  };
}

export function clampAim(side, angle) {
  const forward = side === 0 ? 0 : Math.PI;
  let delta = Math.atan2(Math.sin(angle - forward), Math.cos(angle - forward));
  delta = Math.max(-1.05, Math.min(1.05, delta));
  return forward + delta;
}

export function movePlayer(player, dt, height, now, speedMultiplier = 1) {
  if (now < player.dodgeUntil) return;
  player.y += player.direction * player.speed * speedMultiplier * dt;
  const bound = Math.max(26, height - 26);
  if (player.y < 26) { player.y = 26; player.direction = 1; }
  if (player.y > bound) { player.y = bound; player.direction = -1; }
  player.speed = Math.min(260, player.speed + dt * 1.25);
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
