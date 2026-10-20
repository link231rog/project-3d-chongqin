import * as THREE from 'three';

const TILE = 256;
const GRID = 4;
const SIZE = TILE * GRID;

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// 4x4 window-module atlas. The shader repeats one cell per facade module and
// selects a tile per building, so the city gets facade variation without 16 materials.
export function createFacadeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cfcfcf';
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let style = 0; style < 16; style++) {
    const ox = (style % GRID) * TILE;
    const oy = Math.floor(style / GRID) * TILE;
    const kind = style % 4;
    const random = seeded(97 + style * 131);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, TILE, TILE);
    ctx.clip();

    const wall = kind === 1 ? '#c9b9a7' : kind === 2 ? '#aebcc2' : kind === 3 ? '#d5cfc2' : '#d8d5cd';
    ctx.fillStyle = wall;
    ctx.fillRect(ox, oy, TILE, TILE);

    // Low-contrast grain keeps the palette tint readable at distance.
    for (let i = 0; i < 260; i++) {
      const x = ox + random() * TILE;
      const y = oy + random() * TILE;
      const alpha = 0.05 + random() * 0.09;
      ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      ctx.fillRect(x, y, 1 + random() * 2, 1 + random() * 2);
    }

    if (kind === 1) {
      ctx.strokeStyle = 'rgba(90,70,55,0.18)';
      ctx.lineWidth = 1;
      for (let y = oy; y < oy + TILE; y += 12) {
        ctx.beginPath();
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + TILE, y);
        ctx.stroke();
      }
    }

    const inset = kind === 2 ? 18 : 46 + (style % 3) * 6;
    const wx = ox + inset;
    const wy = oy + 40 + (style % 2) * 8;
    const ww = TILE - inset * 2;
    const wh = TILE - 84 - (style % 2) * 10;

    ctx.fillStyle = kind === 2 ? 'rgba(210,218,222,0.55)' : 'rgba(120,124,126,0.85)';
    ctx.fillRect(wx - 7, wy - 7, ww + 14, wh + 14);

    const glass = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
    glass.addColorStop(0, kind === 2 ? '#a8c0ca' : '#93a8b2');
    glass.addColorStop(0.45, '#5d737e');
    glass.addColorStop(1, '#394b54');
    ctx.fillStyle = glass;
    ctx.fillRect(wx, wy, ww, wh);

    ctx.strokeStyle = 'rgba(225,230,232,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, wy);
    ctx.lineTo(wx + ww / 2, wy + wh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wx, wy + wh * 0.42);
    ctx.lineTo(wx + ww, wy + wh * 0.42);
    ctx.stroke();

    ctx.fillStyle = 'rgba(235,232,224,0.65)';
    ctx.fillRect(wx - 9, wy + wh + 5, ww + 18, 5);

    if (kind === 3) {
      ctx.strokeStyle = 'rgba(80,82,80,0.45)';
      ctx.lineWidth = 2;
      const railY = wy + wh - 12;
      ctx.beginPath();
      ctx.moveTo(wx - 4, railY);
      ctx.lineTo(wx + ww + 4, railY);
      ctx.stroke();
      for (let x = wx; x <= wx + ww; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, railY);
        ctx.lineTo(x, railY + 12);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
