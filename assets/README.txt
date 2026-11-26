ARCADE DUEL weapon image slots

Optional transparent PNG sprites:
  weapons/weapon-left.png
  weapons/weapon-right.png

Sprites are loaded by js/assets.js. Both images should face right in their
source files and use a transparent or pure-black background. The right-side
weapon is mirrored and rotated by the loader. If a file is absent or fails to
load, the game draws its weapon with Canvas vectors instead.

To supply generated variants before js/main.js loads, define
window.ARCADE_WEAPONS = { left: "assets/weapons/custom-left.png",
                          right: "assets/weapons/custom-right.png" }.
