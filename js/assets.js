const DEFAULT_SPRITES = {
  left: "assets/weapons/weapon-left.png",
  right: "assets/weapons/weapon-right.png"
};

export class AssetLoader {
  constructor() {
    this.sprites = { left: null, right: null };
    this.ready = this.preload();
  }

  async preload() {
    const configured = { ...DEFAULT_SPRITES, ...(window.ARCADE_WEAPONS || {}) };
    await Promise.all(Object.entries(configured).map(([side, source]) => new Promise(resolve => {
      if (!source) return resolve();
      const image = new Image();
      image.onload = () => { this.sprites[side] = image; resolve(); };
      image.onerror = () => resolve();
      image.src = source;
    })));
    return this.sprites;
  }

  drawWeapon(ctx, player, side) {
    const image = this.sprites[side];
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate((player.aim || 0) + (side === "right" ? Math.PI : 0));
    if (side === "right") ctx.scale(-1, 1);
    const recoil = player.recoil > 0 ? Math.min(player.recoil * 5, 8) : 0;
    ctx.translate(-recoil, 0);
    if (image && image.complete && image.naturalWidth) {
      ctx.drawImage(image, -25, -12, 50, 24);
    } else {
      ctx.fillStyle = side === "left" ? "#31f5ff" : "#ff3fa4";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fillRect(-18, -8, 24, 16);
      ctx.fillStyle = "#fff";
      ctx.fillRect(2, -3, 20, 6);
      ctx.fillStyle = "#73808a";
      ctx.fillRect(-11, -12, 8, 24);
    }
    ctx.restore();
  }
}
