import * as THREE from 'three';
import { ctx2d } from '../dom';
import { TAU } from '../constants';
import { clamp, mulberry32 } from '../math';
let anisotropy = 1;
function makeGroundTex() {
  const sz = 1024, c = document.createElement('canvas'); c.width = c.height = sz;
  const g = ctx2d(c), R = mulberry32(77);
  g.fillStyle = '#6b5638'; g.fillRect(0, 0, sz, sz);
  const wrap = (fn: (x: number, y: number) => void, x: number, y: number, m: number) => { for (const dx of [-sz, 0, sz]) for (const dy of [-sz, 0, sz]) { const X = x + dx, Y = y + dy; if (X > -m && X < sz + m && Y > -m && Y < sz + m) fn(X, Y); } };
  for (let i = 0; i < 80; i++) {
    const x = R() * sz, y = R() * sz, r = 40 + R() * 130, dark = R() < 0.5, c0 = dark ? '28,20,10' : '150,120,66';
    wrap((X: number, Y: number) => { const gr = g.createRadialGradient(X, Y, 0, X, Y, r); gr.addColorStop(0, 'rgba(' + c0 + ',' + (dark ? 0.38 : 0.24) + ')'); gr.addColorStop(1, 'rgba(' + c0 + ',0)'); g.fillStyle = gr; g.fillRect(X - r, Y - r, r * 2, r * 2); }, x, y, r);
  }
  const needle = ['#8a6a3a', '#6e5230', '#a58548', '#4f3b22', '#7a6a3e', '#93794a', '#3f2f1c'];
  g.lineCap = 'round';
  for (let i = 0; i < 7500; i++) {
    const x = R() * sz, y = R() * sz, a = R() * TAU, l = 26 + R() * 70;
    g.strokeStyle = needle[(R() * needle.length) | 0]; g.globalAlpha = 0.5 + R() * 0.4; g.lineWidth = 1.2 + R() * 2;
    const dx = Math.cos(a) * l / 2, dy = Math.sin(a) * l / 2;
    wrap((X: number, Y: number) => { g.beginPath(); g.moveTo(X - dx, Y - dy); g.lineTo(X + dx, Y + dy); g.stroke(); }, x, y, l);
  }
  const leaf = ['#7a4a22', '#9a6a2a', '#5c3a1c', '#8a5a2a', '#6a5a24', '#a07a30', '#b0561c'];
  for (let i = 0; i < 300; i++) {
    const x = R() * sz, y = R() * sz, rw = 8 + R() * 20, rh = rw * (0.4 + R() * 0.3), an = R() * TAU;
    g.globalAlpha = 0.78; g.fillStyle = leaf[(R() * leaf.length) | 0];
    wrap((X: number, Y: number) => { g.beginPath(); g.ellipse(X, Y, rw, rh, an, 0, TAU); g.fill(); }, x, y, rw);
    g.globalAlpha = 0.35; g.strokeStyle = '#2b1d0e'; g.lineWidth = 1;
    const vx = Math.cos(an) * rw, vy = Math.sin(an) * rw;
    wrap((X: number, Y: number) => { g.beginPath(); g.moveTo(X - vx, Y - vy); g.lineTo(X + vx, Y + vy); g.stroke(); }, x, y, rw);
  }
  for (let i = 0; i < 1800; i++) {
    const x = R() * sz, y = R() * sz, r = 1.5 + R() * 4;
    g.globalAlpha = 0.5; g.fillStyle = R() < 0.7 ? '#4d6b2e' : '#1c140a';
    wrap((X: number, Y: number) => { g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill(); }, x, y, r);
  }
  g.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = anisotropy;
  /* normal map derived from the luminance of the same painting */
  const id = g.getImageData(0, 0, sz, sz).data, h = new Float32Array(sz * sz);
  for (let i = 0; i < sz * sz; i++) h[i] = (id[i * 4] * 0.3 + id[i * 4 + 1] * 0.59 + id[i * 4 + 2] * 0.11) / 255;
  const nc = document.createElement('canvas'); nc.width = nc.height = sz; const ng = ctx2d(nc), out = ng.createImageData(sz, sz);
  for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
    const xl = h[y * sz + ((x - 1 + sz) % sz)], xr = h[y * sz + ((x + 1) % sz)], yu = h[((y - 1 + sz) % sz) * sz + x], yd = h[((y + 1) % sz) * sz + x];
    let nx = (xl - xr) * 3.2, ny = (yu - yd) * 3.2, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * sz + x) * 4; out.data[o] = (nx * 0.5 + 0.5) * 255; out.data[o + 1] = (ny * 0.5 + 0.5) * 255; out.data[o + 2] = (nz * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  ng.putImageData(out, 0, 0);
  const normal = new THREE.CanvasTexture(nc); normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.anisotropy = anisotropy;
  return { map, normal };
}
function makeGlowTex(rgb: string) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = ctx2d(c);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.25, 'rgba(' + rgb + ',0.45)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
function makeShaftTex() {
  const w = 64, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = ctx2d(c), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ax = Math.exp(-Math.pow((x - 31.5) / 13, 2)), ay = Math.pow(Math.sin(Math.PI * (y + 0.5) / h), 1.1), i = (y * w + x) * 4;
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.round(255 * ax * ay);
  }
  g.putImageData(img, 0, 0); return new THREE.CanvasTexture(c);
}
function makeBlockTex(kind: string) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = ctx2d(c), R = mulberry32(kind === 'plank' ? 5 : 6);
  if (kind === 'plank') {
    for (let i = 0; i < 4; i++) {
      const v = 0.9 + R() * 0.2; g.fillStyle = 'rgb(' + Math.round(186 * v) + ',' + Math.round(134 * v) + ',' + Math.round(80 * v) + ')'; g.fillRect(0, i * 32, 128, 32);
      g.strokeStyle = 'rgba(70,40,15,0.45)'; g.lineWidth = 1;
      for (let k = 0; k < 9; k++) { const y = i * 32 + 3 + R() * 26; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(40, y + R() * 4 - 2, 80, y + R() * 4 - 2, 128, y + R() * 3); g.stroke(); }
      g.fillStyle = 'rgba(50,28,10,0.8)'; g.fillRect(0, i * 32, 128, 2);
      g.fillStyle = 'rgba(40,30,25,0.9)'; g.beginPath(); g.arc(8, i * 32 + 16, 1.6, 0, TAU); g.arc(120, i * 32 + 16, 1.6, 0, TAU); g.fill();
    }
  } else if (kind === 'dirt') {
    g.fillStyle = '#6b5034'; g.fillRect(0, 0, 128, 128); const cols = ['#4a3622', '#83653f', '#5a4229', '#93754a'];
    for (let i = 0; i < 900; i++) { g.fillStyle = cols[(R() * 4) | 0]; g.globalAlpha = 0.5 + R() * 0.4; g.fillRect(R() * 128, R() * 128, 1 + R() * 5, 1 + R() * 5); } g.globalAlpha = 1;
    g.strokeStyle = 'rgba(30,20,10,0.5)'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
  } else {
    g.fillStyle = '#5f6266'; g.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 4; r++) for (let b = -1; b < 3; b++) {
      const off = r % 2 ? 32 : 0, x = b * 64 + off, v = 0.85 + R() * 0.25;
      g.fillStyle = 'rgb(' + Math.round(140 * v) + ',' + Math.round(143 * v) + ',' + Math.round(148 * v) + ')'; g.fillRect(x + 2, r * 32 + 2, 60, 28);
    }
    for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(' + (R() < 0.5 ? '255,255,255' : '20,20,20') + ',0.08)'; g.fillRect(R() * 128, R() * 128, 2, 2); }
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = anisotropy; return t;
}
function makeVoxelAtlas() {
  const TS = 128, c = document.createElement('canvas'); c.width = TS * 8; c.height = TS * 3; const g = ctx2d(c), R = mulberry32(404);
  const org = (t: number) => [(t % 8) * TS, ((t / 8) | 0) * TS];
  const fillT = (t: number, col: string) => { const [x, y] = org(t); g.fillStyle = col; g.fillRect(x, y, TS, TS); };
  const speck = (t: number, n: number, cols: string[], rmax: number) => { const [x, y] = org(t); for (let i = 0; i < n; i++) { g.fillStyle = cols[(R() * cols.length) | 0]; g.globalAlpha = 0.5 + R() * 0.4; g.fillRect(x + R() * TS, y + R() * TS, 1 + R() * rmax, 1 + R() * rmax); } g.globalAlpha = 1; };
  const blobs = (t: number, n: number, col: string, hi: string, rmin: number, rmax: number) => { const [x, y] = org(t); for (let i = 0; i < n; i++) { const bx = x + 10 + R() * (TS - 20), by = y + 10 + R() * (TS - 20), r = rmin + R() * (rmax - rmin); g.fillStyle = col; g.beginPath(); g.arc(bx, by, r, 0, TAU); g.fill(); g.fillStyle = hi; g.beginPath(); g.arc(bx - r * 0.25, by - r * 0.25, r * 0.5, 0, TAU); g.fill(); } };
  const fringe = (t: number, cols: string[], hmin: number, hmax: number) => { const [x, y] = org(t); for (let q = 0; q < TS; q += 4) { const h = hmin + R() * (hmax - hmin); g.fillStyle = cols[(R() * cols.length) | 0]; g.fillRect(x + q, y, 4, h); g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x + q, y + h, 4, 3); } };
  const dirtC = ['#4a3622', '#83653f', '#5a4229', '#93754a'], stoneC = ['#5f6266', '#9a9da1', '#6b6e72', '#8a8d91'];
  fillT(0, '#6b5034'); speck(0, 900, dirtC, 5);
  fillT(1, '#6b5034'); speck(1, 900, dirtC, 5); fringe(1, ['#7a4a22', '#9a6a2a', '#5c3a1c', '#6a5a24', '#8a5a2a'], 14, 28);
  fillT(2, '#7b7d81'); speck(2, 1100, stoneC, 6);
  { const [x, y] = org(2); g.strokeStyle = 'rgba(30,30,34,0.35)'; g.lineWidth = 1.5; for (let i = 0; i < 6; i++) { g.beginPath(); let px = x + R() * TS, py = y + R() * TS; g.moveTo(px, py); for (let q = 0; q < 4; q++) { px += (R() - 0.5) * 40; py += (R() - 0.5) * 40; g.lineTo(clamp(px, x, x + TS), clamp(py, y, y + TS)); } g.stroke(); } }
  fillT(3, '#7b7d81'); speck(3, 1000, stoneC, 6); blobs(3, 9, '#c9601c', '#e8903a', 5, 13);
  fillT(4, '#7b7d81'); speck(4, 1000, stoneC, 6); blobs(4, 11, '#1b1b1f', '#4a4a52', 5, 12);
  fillT(5, '#2c2c31'); speck(5, 1300, ['#1a1a1d', '#3d3d44', '#25252a', '#4a4a52'], 8);
  fillT(6, '#dccb8b'); speck(6, 1200, ['#c9b673', '#efe0a4', '#d3c07e', '#b9a765'], 3);
  fillT(7, '#cdb377'); speck(7, 900, ['#b89c5c', '#dcc48a', '#c2a668'], 3); { const [x, y] = org(7); for (let q = 0; q < 5; q++) { g.fillStyle = 'rgba(120,90,40,0.18)'; g.fillRect(x, y + 12 + q * 24 + R() * 6, TS, 4); } }
  fillT(8, '#f1f5f9'); speck(8, 500, ['#dfe8f2', '#ffffff', '#cfdbe8'], 3);
  fillT(9, '#6b5034'); speck(9, 900, dirtC, 5); fringe(9, ['#f4f8fb', '#e6eef6', '#ffffff'], 16, 30);
  fillT(10, '#7d7d7f'); speck(10, 60, ['#5a5a5d', '#9a9a9d', '#6e6e72', '#b0b0b3', '#7a706a'], 14); speck(10, 700, ['#55555a', '#a4a4a8'], 4);
  fillT(11, '#5f9d3a'); speck(11, 1100, ['#4c8a2c', '#79b84a', '#3f7a25', '#8fcb5a'], 4);
  fillT(12, '#6b5034'); speck(12, 900, dirtC, 5); fringe(12, ['#5f9d3a', '#4c8a2c', '#79b84a', '#3f7a25'], 14, 26);
  fillT(14, '#c8410c'); speck(14, 600, ['#7a1d05', '#ff8a1e'], 8); blobs(14, 8, '#ff9a2a', '#ffe27a', 7, 16);
  { const [x, y] = org(15); fillT(15, '#2a8fb0'); for (let i = 0; i < 7; i++) { const cx = x + 14 + R() * 100, cy = y + 14 + R() * 100, r = 12 + R() * 16; g.fillStyle = '#7ff0ff'; g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.6, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.6, cy); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.6, cy); g.lineTo(cx, cy); g.closePath(); g.fill(); } }
  { const [x, y] = org(16); g.drawImage(makeBlockTex('plank').image, x, y, TS, TS); const [bx, by] = org(17); g.drawImage(makeBlockTex('brick').image, bx, by, TS, TS); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = anisotropy; return t;
}
function makeWaterTex() {
  const sz = 256, c = document.createElement('canvas'); c.width = c.height = sz; const g = ctx2d(c), img = g.createImageData(sz, sz), k = TAU / sz;
  for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
    const v = 0.5 + 0.22 * Math.sin((x * 3 + y * 2) * k) + 0.16 * Math.sin((y * 5 - x * 2) * k + 1.3) + 0.12 * Math.sin((x * 7 + y * 4) * k + 2.1), o = (y * sz + x) * 4;
    img.data[o] = 40 + v * 90; img.data[o + 1] = 105 + v * 100; img.data[o + 2] = 150 + v * 90; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; return t;
}
export function createTextures(aniso: number) {
  anisotropy = aniso;
  const ground = makeGroundTex(), atlasTex = makeVoxelAtlas(), waterTex = makeWaterTex();
  const glowWarm = makeGlowTex('255,190,90'), glowRed = makeGlowTex('255,80,60'), moteTex = makeGlowTex('255,255,255'), shaftTex = makeShaftTex();
  return { ground, atlasTex, waterTex, glowWarm, glowRed, moteTex, shaftTex };
}
