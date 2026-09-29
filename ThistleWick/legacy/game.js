(() => {
'use strict';

/* ================= constants and helpers ================= */
const S = 40, RAD = 2, TAU = Math.PI * 2, DAY_LEN = 300, TILE = 10, REACH = 5.4, PHGT = 1.5, PRAD = 0.4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const $ = id => document.getElementById(id);

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s || 0) | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o, s) { let a = 0.5, f = 1, sum = 0; for (let i = 0; i < o; i++) { sum += a * vnoise(x * f, y * f, s + i * 7); f *= 2; a *= 0.5; } return sum; }
/* World data lives in WG (worldgen.js): chunks of 1x1x1 blocks with biomes, mountains, lakes and caves. */
const { JMIN, JMAX, SEA, LAVA_Y, B, BIOME } = WG, SS = S * S;
const H = (x, z) => WG.terr(Math.floor(x), Math.floor(z)).h;
function baseH(x, z, r) { return Math.min(H(x - r, z - r), H(x + r, z - r), H(x - r, z + r), H(x + r, z + r)); }
function N(x, z, out) { return out.set(0, 1, 0); }

/* ================= renderer, scene, lights, post ================= */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b3c78c');
scene.fog = new THREE.FogExp2('#b3c78c', 0.015);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 700);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xdff0b4, 0x403a22, 0.8); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0c0, 1.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
{ const c = sun.shadow.camera; c.left = -36; c.right = 36; c.top = 36; c.bottom = -36; c.near = 1; c.far = 420; }
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun); scene.add(sun.target);
const lantern = new THREE.PointLight(0xffc27a, 0.6, 16, 2); scene.add(lantern);
const fireLights = [];
for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff9a3c, 0, 24, 2); scene.add(l); fireLights.push(l); }

const U = { time: { value: 0 } };
const anisotropy = renderer.capabilities.getMaxAnisotropy();

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uDmg: { value: 0 }, uVig: { value: 0.55 }, uSat: { value: 1.14 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform float uTime, uDmg, uVig, uSat; uniform vec3 uTint; varying vec2 vUv;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n' +
    'void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; c *= uTint;\n' +
    ' c = mix(c, c * c * (3.0 - 2.0 * c), 0.42);\n' +
    ' float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat);\n' +
    ' vec2 d = vUv - 0.5; float v = smoothstep(0.9, 0.22, length(d * vec2(1.15, 1.0))); c *= mix(1.0, v, uVig);\n' +
    ' c += (hash(vUv * vec2(1920.0, 1080.0) + uTime) - 0.5) * 0.028;\n' +
    ' c = mix(c, vec3(0.75, 0.05, 0.04), uDmg * smoothstep(0.15, 0.75, length(d)));\n' +
    ' gl_FragColor = vec4(c, 1.0); }'
};
let composer = null, bloom = null, grade = null;
try {
  if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && THREE.ShaderPass && THREE.CopyShader && THREE.WebGLMultisampleRenderTarget) {
    const w = Math.floor(innerWidth * pixelRatio), h = Math.floor(innerHeight * pixelRatio);
    const rt = new THREE.WebGLMultisampleRenderTarget(w, h, { format: THREE.RGBAFormat });
    composer = new THREE.EffectComposer(renderer, rt);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.65, 0.88);
    composer.addPass(bloom);
    grade = new THREE.ShaderPass(GradeShader); composer.addPass(grade);
  }
} catch (e) { composer = null; }

/* ================= textures ================= */
function makeGroundTex() {
  const sz = 1024, c = document.createElement('canvas'); c.width = c.height = sz;
  const g = c.getContext('2d'), R = mulberry32(77);
  g.fillStyle = '#6b5638'; g.fillRect(0, 0, sz, sz);
  const wrap = (fn, x, y, m) => { for (const dx of [-sz, 0, sz]) for (const dy of [-sz, 0, sz]) { const X = x + dx, Y = y + dy; if (X > -m && X < sz + m && Y > -m && Y < sz + m) fn(X, Y); } };
  for (let i = 0; i < 80; i++) {
    const x = R() * sz, y = R() * sz, r = 40 + R() * 130, dark = R() < 0.5, c0 = dark ? '28,20,10' : '150,120,66';
    wrap((X, Y) => { const gr = g.createRadialGradient(X, Y, 0, X, Y, r); gr.addColorStop(0, 'rgba(' + c0 + ',' + (dark ? 0.38 : 0.24) + ')'); gr.addColorStop(1, 'rgba(' + c0 + ',0)'); g.fillStyle = gr; g.fillRect(X - r, Y - r, r * 2, r * 2); }, x, y, r);
  }
  const needle = ['#8a6a3a', '#6e5230', '#a58548', '#4f3b22', '#7a6a3e', '#93794a', '#3f2f1c'];
  g.lineCap = 'round';
  for (let i = 0; i < 7500; i++) {
    const x = R() * sz, y = R() * sz, a = R() * TAU, l = 26 + R() * 70;
    g.strokeStyle = needle[(R() * needle.length) | 0]; g.globalAlpha = 0.5 + R() * 0.4; g.lineWidth = 1.2 + R() * 2;
    const dx = Math.cos(a) * l / 2, dy = Math.sin(a) * l / 2;
    wrap((X, Y) => { g.beginPath(); g.moveTo(X - dx, Y - dy); g.lineTo(X + dx, Y + dy); g.stroke(); }, x, y, l);
  }
  const leaf = ['#7a4a22', '#9a6a2a', '#5c3a1c', '#8a5a2a', '#6a5a24', '#a07a30', '#b0561c'];
  for (let i = 0; i < 300; i++) {
    const x = R() * sz, y = R() * sz, rw = 8 + R() * 20, rh = rw * (0.4 + R() * 0.3), an = R() * TAU;
    g.globalAlpha = 0.78; g.fillStyle = leaf[(R() * leaf.length) | 0];
    wrap((X, Y) => { g.beginPath(); g.ellipse(X, Y, rw, rh, an, 0, TAU); g.fill(); }, x, y, rw);
    g.globalAlpha = 0.35; g.strokeStyle = '#2b1d0e'; g.lineWidth = 1;
    const vx = Math.cos(an) * rw, vy = Math.sin(an) * rw;
    wrap((X, Y) => { g.beginPath(); g.moveTo(X - vx, Y - vy); g.lineTo(X + vx, Y + vy); g.stroke(); }, x, y, rw);
  }
  for (let i = 0; i < 1800; i++) {
    const x = R() * sz, y = R() * sz, r = 1.5 + R() * 4;
    g.globalAlpha = 0.5; g.fillStyle = R() < 0.7 ? '#4d6b2e' : '#1c140a';
    wrap((X, Y) => { g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill(); }, x, y, r);
  }
  g.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = anisotropy;
  /* normal map derived from the luminance of the same painting */
  const id = g.getImageData(0, 0, sz, sz).data, h = new Float32Array(sz * sz);
  for (let i = 0; i < sz * sz; i++) h[i] = (id[i * 4] * 0.3 + id[i * 4 + 1] * 0.59 + id[i * 4 + 2] * 0.11) / 255;
  const nc = document.createElement('canvas'); nc.width = nc.height = sz; const ng = nc.getContext('2d'), out = ng.createImageData(sz, sz);
  for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
    const xl = h[y * sz + ((x - 1 + sz) % sz)], xr = h[y * sz + ((x + 1) % sz)], yu = h[((y - 1 + sz) % sz) * sz + x], yd = h[((y + 1) % sz) * sz + x];
    let nx = (xl - xr) * 3.2, ny = (yu - yd) * 3.2, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * sz + x) * 4; out.data[o] = (nx * 0.5 + 0.5) * 255; out.data[o + 1] = (ny * 0.5 + 0.5) * 255; out.data[o + 2] = (nz * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  ng.putImageData(out, 0, 0);
  const normal = new THREE.CanvasTexture(nc); normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.anisotropy = anisotropy;
  return { map, normal };
}
function makeGlowTex(rgb) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.25, 'rgba(' + rgb + ',0.45)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
function makeShaftTex() {
  const w = 64, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ax = Math.exp(-Math.pow((x - 31.5) / 13, 2)), ay = Math.pow(Math.sin(Math.PI * (y + 0.5) / h), 1.1), i = (y * w + x) * 4;
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.round(255 * ax * ay);
  }
  g.putImageData(img, 0, 0); return new THREE.CanvasTexture(c);
}
function makeBlockTex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), R = mulberry32(kind === 'plank' ? 5 : 6);
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
  const TS = 128, c = document.createElement('canvas'); c.width = TS * 8; c.height = TS * 3; const g = c.getContext('2d'), R = mulberry32(404);
  const org = t => [(t % 8) * TS, ((t / 8) | 0) * TS];
  const fillT = (t, col) => { const [x, y] = org(t); g.fillStyle = col; g.fillRect(x, y, TS, TS); };
  const speck = (t, n, cols, rmax) => { const [x, y] = org(t); for (let i = 0; i < n; i++) { g.fillStyle = cols[(R() * cols.length) | 0]; g.globalAlpha = 0.5 + R() * 0.4; g.fillRect(x + R() * TS, y + R() * TS, 1 + R() * rmax, 1 + R() * rmax); } g.globalAlpha = 1; };
  const blobs = (t, n, col, hi, rmin, rmax) => { const [x, y] = org(t); for (let i = 0; i < n; i++) { const bx = x + 10 + R() * (TS - 20), by = y + 10 + R() * (TS - 20), r = rmin + R() * (rmax - rmin); g.fillStyle = col; g.beginPath(); g.arc(bx, by, r, 0, TAU); g.fill(); g.fillStyle = hi; g.beginPath(); g.arc(bx - r * 0.25, by - r * 0.25, r * 0.5, 0, TAU); g.fill(); } };
  const fringe = (t, cols, hmin, hmax) => { const [x, y] = org(t); for (let q = 0; q < TS; q += 4) { const h = hmin + R() * (hmax - hmin); g.fillStyle = cols[(R() * cols.length) | 0]; g.fillRect(x + q, y, 4, h); g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x + q, y + h, 4, 3); } };
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
  const sz = 256, c = document.createElement('canvas'); c.width = c.height = sz; const g = c.getContext('2d'), img = g.createImageData(sz, sz), k = TAU / sz;
  for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
    const v = 0.5 + 0.22 * Math.sin((x * 3 + y * 2) * k) + 0.16 * Math.sin((y * 5 - x * 2) * k + 1.3) + 0.12 * Math.sin((x * 7 + y * 4) * k + 2.1), o = (y * sz + x) * 4;
    img.data[o] = 40 + v * 90; img.data[o + 1] = 105 + v * 100; img.data[o + 2] = 150 + v * 90; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; return t;
}
const ground = makeGroundTex(), atlasTex = makeVoxelAtlas(), waterTex = makeWaterTex();
const glowWarm = makeGlowTex('255,190,90'), glowRed = makeGlowTex('255,80,60'), moteTex = makeGlowTex('255,255,255'), shaftTex = makeShaftTex();

/* ================= geometry builders ================= */
const dummy = new THREE.Object3D();
const tmpN = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), tiltQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0), tmpC = new THREE.Color();

function mergeGeos(parts) {
  const P = [], Nn = [], C = [];
  for (const part of parts) {
    let g = part.g.index ? part.g.toNonIndexed() : part.g.clone();
    if (part.m) g.applyMatrix4(part.m);
    if (part.flat) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (part.up) Nn.push(0, 1, 0); else Nn.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      const col = typeof part.c === 'function' ? part.c(pos.getX(i), pos.getY(i), pos.getZ(i)) : part.c;
      C.push(col[0], col[1], col[2]);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return out;
}
function tri(P, C, a, b, c, ca, cb, cc) { P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); C.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]); }
function finishUpGeo(P, C) {
  const g = new THREE.BufferGeometry(), n = P.length / 3, Nn = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) Nn[i * 3 + 1] = 1;
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
const mat4 = (x, y, z, rx, ry, rz, sx, sy, sz) => { dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); return dummy.matrix.clone(); };

function makeGrassGeo(lo, hi, wid) {
  const P = [], C = [], seg = 4, rows = [];
  for (let i = 0; i <= seg; i++) {
    const y = i / seg, hw = wid * (1 - y * 0.93), cx = 0.34 * y * y;
    rows.push({ l: [cx - hw, y, 0], r: [cx + hw, y, 0], col: [lerp(lo[0], hi[0], y), lerp(lo[1], hi[1], y), lerp(lo[2], hi[2], y)] });
  }
  for (let i = 0; i < seg; i++) { const a = rows[i], b = rows[i + 1]; tri(P, C, a.l, a.r, b.l, a.col, a.col, b.col); tri(P, C, a.r, b.r, b.l, a.col, b.col, b.col); }
  return finishUpGeo(P, C);
}
function makeFernGeo() {
  const P = [], C = [], nF = 8, seg = 16;
  for (let f = 0; f < nF; f++) {
    const yaw = f / nF * TAU + Math.sin(f * 12.9) * 0.35, dx = Math.cos(yaw), dz = Math.sin(yaw);
    const len = 0.85 + 0.25 * (((f * 37) % 5) / 5), tone = 0.85 + 0.3 * ((f * 13) % 7) / 7, pts = [];
    for (let k = 0; k <= seg; k++) { const t = k / seg, reach = len * 0.95 * t * (1 - 0.15 * t), y = len * (1.7 * t - 1.5 * t * t) + 0.03; pts.push([dx * reach, y, dz * reach]); }
    const sx = -dz, sz = dx;
    for (let k = 2; k < seg; k++) {
      const t = k / seg, p = pts[k], a = pts[k - 1], b = pts[k + 1];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      const ll = len * (0.03 + 0.3 * Math.sin(Math.PI * Math.pow(t, 0.8))), hw = len * 0.03;
      const cb = [lerp(0.1, 0.16, t) * tone, lerp(0.26, 0.4, t) * tone, lerp(0.08, 0.12, t) * tone], ct = [lerp(0.2, 0.42, t) * tone, lerp(0.42, 0.66, t) * tone, lerp(0.12, 0.22, t) * tone];
      for (const s of [-1, 1]) {
        const tip = [p[0] + sx * ll * s + tx * ll * 0.45, p[1] - ll * 0.3 + ty * ll * 0.45, p[2] + sz * ll * s + tz * ll * 0.45];
        tri(P, C, [p[0] - tx * hw, p[1] - ty * hw, p[2] - tz * hw], [p[0] + tx * hw, p[1] + ty * hw, p[2] + tz * hw], tip, cb, cb, ct);
      }
    }
  }
  return finishUpGeo(P, C);
}
function makeMushroom(kind, R0) {
  const parts = [], R = mulberry32(R0 || (kind === 'red' ? 5 : 8));
  const stem = new THREE.CylinderGeometry(0.22, 0.3, 1.2, 10, 3); stem.translate(0, 0.6, 0);
  parts.push({ g: stem, c: [0.93, 0.9, 0.8] });
  const cap = new THREE.SphereGeometry(1, 18, 8, 0, TAU, 0, Math.PI / 2); cap.scale(1, 0.55, 1); cap.translate(0, 1.15, 0);
  parts.push({ g: cap, c: kind === 'red' ? [0.82, 0.14, 0.1] : kind === 'tan' ? [0.78, 0.6, 0.36] : [0.55, 0.36, 0.2] });
  const gill = new THREE.CircleGeometry(0.98, 18); gill.rotateX(Math.PI / 2); gill.translate(0, 1.15, 0);
  parts.push({ g: gill, c: [0.85, 0.78, 0.6] });
  if (kind === 'red') {
    const sp = new THREE.SphereGeometry(0.12, 8, 6);
    for (let i = 0; i < 10; i++) {
      const th = R() * TAU, ph = 0.15 + R() * 1.0, nx = Math.sin(ph) * Math.cos(th), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(th);
      dummy.position.set(nx * 0.99, 1.15 + ny * 0.55 * 0.99, nz * 0.99); dummy.quaternion.setFromUnitVectors(UP, new THREE.Vector3(nx, ny, nz).normalize()); dummy.scale.set(1, 0.35, 1); dummy.updateMatrix();
      parts.push({ g: sp, m: dummy.matrix.clone(), c: [0.98, 0.96, 0.9] });
    }
  }
  return mergeGeos(parts);
}
function makeLeafGeo() {
  const nu = 8, nv = 4, pos = [], col = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const t = i / nu, zc = t - 0.5, w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.94 + 0.03)), 0.85) * (0.32 + 0.05 * Math.sin(t * 20));
    for (let j = 0; j <= nv; j++) { const v = j / nv * 2 - 1, x = v * w, y = Math.abs(x) * 0.5 + zc * zc * 0.3, sh = 0.78 + 0.22 * Math.abs(v); pos.push(x, y, zc); col.push(sh, sh, sh); }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function makeTwigGeo() {
  const R = mulberry32(21), parts = [], main = new THREE.CylinderGeometry(0.7, 1, 1, 6, 4); main.rotateX(Math.PI / 2);
  const bark = () => { const j = 0.85 + R() * 0.3; return [0.36 * j, 0.27 * j, 0.19 * j]; };
  parts.push({ g: main, c: () => bark() });
  for (const [z0, a] of [[0.1, 0.7], [-0.2, -0.8]]) {
    const b = new THREE.CylinderGeometry(0.22, 0.45, 0.4, 5, 1); b.translate(0, 0.2, 0);
    parts.push({ g: b, m: new THREE.Matrix4().makeTranslation(0, 0, z0).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), c: () => bark() });
  }
  return mergeGeos(parts);
}
function makeRock(seed, ore) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, R = mulberry32(seed), a = [R() * 6, R() * 6, R() * 6, R() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.2 * Math.sin(3.1 * x + a[0]) * Math.cos(2.3 * z + a[1]) + 0.12 * Math.sin(6.3 * y + 4.7 * x + a[2]) + 0.07 * Math.sin(11 * z + 9 * y + a[3]);
    p.setXYZ(i, x * d, y * d * 0.8, z * d);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal, col = [];
  for (let i = 0; i < p.count; i++) {
    const j = 0.8 + R() * 0.3, moss = smooth(0.35, 0.85, n.getY(i));
    let r = lerp(0.5, 0.3, moss) * j, gg = lerp(0.5, 0.42, moss) * j, b = lerp(0.48, 0.24, moss) * j;
    if (ore) {
      const fl = Math.sin(p.getX(i) * 9 + a[0]) * Math.sin(p.getY(i) * 8 + a[1]) * Math.sin(p.getZ(i) * 9 + a[2]);
      if (fl > 0.25) { r = 0.85; gg = 0.42; b = 0.16; } else { r *= 0.8; gg *= 0.8; b *= 0.86; }
    }
    col.push(r, gg, b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return g;
}
function makeFlower(kind) {
  const parts = [], stem = new THREE.CylinderGeometry(0.03, 0.045, 1, 5, 1); stem.translate(0, 0.5, 0); parts.push({ g: stem, c: [0.3, 0.55, 0.2] });
  if (kind === 'bell') {
    const b = new THREE.ConeGeometry(0.17, 0.3, 7, 1, true); b.rotateX(Math.PI); b.translate(0, 0.98, 0); parts.push({ g: b, c: [0.6, 0.45, 0.85] });
    const t = new THREE.SphereGeometry(0.06, 6, 5); t.translate(0, 1.13, 0); parts.push({ g: t, c: [0.4, 0.3, 0.7] });
  } else {
    const pet = new THREE.SphereGeometry(0.1, 6, 5);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; parts.push({ g: pet, m: mat4(Math.cos(a) * 0.14, 1.0, Math.sin(a) * 0.14, 0, -a, 0, 1.5, 0.35, 0.8), c: [0.98, 0.96, 0.88] }); }
    const c = new THREE.SphereGeometry(0.075, 7, 5); c.translate(0, 1.02, 0); parts.push({ g: c, c: [0.98, 0.78, 0.15] });
  }
  return mergeGeos(parts);
}
function makeGiantTrunk(seed) {
  const R = mulberry32(seed), NR = 96, ys = [-2, 0, 0.5, 1, 1.7, 2.6, 3.8, 5.5, 8, 12, 18, 28, 45, 70, 100, 130, 160];
  const ph = [R() * TAU, R() * TAU, R() * TAU, R() * TAU], lobes = 4 + ((R() * 3) | 0), pos = [], col = [], idx = [];
  for (let k = 0; k < ys.length; k++) {
    const y = ys[k], yy = Math.max(y, 0);
    for (let i = 0; i < NR; i++) {
      const a = i / NR * TAU, ridge = Math.sin(a * 16 + ph[0] + Math.sin(a * 3 + y * 0.05) * 1.5 + y * 0.02);
      const flute = 1 + 0.05 * Math.sin(a * 5 + ph[1]) + 0.035 * Math.sin(a * 9 + ph[2]);
      const flare = Math.exp(-yy / 3.2) * (0.18 + 1.1 * Math.pow(Math.max(0, Math.cos(lobes * a + ph[3])), 3)), taper = 1 - 0.12 * Math.min(1, yy / 160);
      const r = flute * taper + flare + 0.018 * ridge; pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const v = 0.5 + 0.5 * ridge; let cr = 0.2 + 0.14 * v, cg = 0.145 + 0.1 * v, cb = 0.1 + 0.07 * v;
      const moss = Math.max(0, Math.sin(a + ph[0])) * Math.exp(-yy / 7) * (0.6 + 0.4 * Math.sin(a * 7 + ph[1]));
      cr = lerp(cr, 0.22, moss * 0.8); cg = lerp(cg, 0.36, moss * 0.8); cb = lerp(cb, 0.11, moss * 0.8);
      const j = 0.88 + 0.24 * R(); col.push(cr * j, cg * j, cb * j);
    }
  }
  for (let k = 0; k < ys.length - 1; k++) for (let i = 0; i < NR; i++) { const a = k * NR + i, b = k * NR + (i + 1) % NR, c = (k + 1) * NR + i, d = (k + 1) * NR + (i + 1) % NR; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function makeLogGeo() {
  const R = mulberry32(99), g = new THREE.CylinderGeometry(1, 1, 1, 18, 10, false); g.rotateX(Math.PI / 2);
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i); const z = p.getZ(i), r = Math.hypot(x, y), th = Math.atan2(y, x), endcap = Math.abs(z) > 0.499 && r < 0.98;
    if (r > 0.01 && !endcap) { const n = 1 + 0.06 * Math.sin(th * 9 + z * 8) + 0.04 * Math.sin(th * 17 + z * 3); x *= n; y *= n; p.setXY(i, x, y); }
    const j = 0.85 + R() * 0.25;
    if (endcap) { const ring = 0.85 + 0.15 * Math.sin(r * 26); col.push(0.62 * ring, 0.46 * ring, 0.28 * ring); }
    else { const moss = smooth(0.15, 0.8, y) * (0.6 + 0.4 * Math.sin(z * 9 + th * 3)); col.push(lerp(0.3, 0.2, moss) * j, lerp(0.22, 0.4, moss) * j, lerp(0.15, 0.14, moss) * j); }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
/* choppable trees, built at unit trunk radius so instance scale = trunk radius */
function makeSpruce(seed) {
  const R = mulberry32(seed), parts = [], trunk = new THREE.CylinderGeometry(0.75, 1, 24, 8, 4); trunk.translate(0, 12, 0);
  parts.push({ g: trunk, c: () => { const j = 0.85 + R() * 0.3; return [0.27 * j, 0.19 * j, 0.13 * j]; } });
  for (let i = 0; i < 6; i++) {
    const y = 5 + i * 3.4, r = 6.4 - i * 1.0, h = 5.4, v = 0.85 + R() * 0.3, cg = new THREE.ConeGeometry(r, h, 9, 1);
    const cp = cg.attributes.position; for (let k = 0; k < cp.count; k++) if (cp.getY(k) < 0) cp.setXYZ(k, cp.getX(k) * (0.9 + R() * 0.2), cp.getY(k), cp.getZ(k) * (0.9 + R() * 0.2));
    cg.translate(0, y + h / 2, 0);
    parts.push({ g: cg, flat: true, c: (x, yy) => { const t = clamp((yy - y) / h, 0, 1); return [lerp(0.07, 0.17, t) * v, lerp(0.22, 0.38, t) * v, lerp(0.09, 0.16, t) * v]; } });
  }
  return mergeGeos(parts);
}
function makeBroad(seed, pal) {
  const R = mulberry32(seed), parts = [], birch = pal !== 2, trunk = new THREE.CylinderGeometry(0.7, 1, 16, 8, 6); trunk.translate(0, 8, 0);
  parts.push({ g: trunk, c: (x, y) => { const band = Math.sin(y * 5 + x * 3) > 0.7; return birch ? (band ? [0.15, 0.14, 0.13] : [0.8, 0.78, 0.72]) : [0.28, 0.2, 0.13]; } });
  const palette = pal === 0 ? [[0.86, 0.62, 0.14], [0.78, 0.5, 0.1]] : pal === 1 ? [[0.86, 0.34, 0.1], [0.7, 0.2, 0.08]] : [[0.3, 0.55, 0.15], [0.2, 0.42, 0.12]];
  const blobs = [[0, 15, 0, 5.4], [3.4, 12.5, 1.2, 3.8], [-3.2, 13, -1.4, 4], [0.6, 19.5, 0.4, 3.6], [-0.8, 12, 3.6, 3.4], [1.4, 12.6, -3.6, 3.6]];
  for (const [x, y, z, r] of blobs) {
    const ig = new THREE.IcosahedronGeometry(r, 1), ip = ig.attributes.position;
    for (let i = 0; i < ip.count; i++) { const d = 0.86 + R() * 0.28; ip.setXYZ(i, ip.getX(i) * d, ip.getY(i) * d * 0.85, ip.getZ(i) * d); }
    ig.translate(x, y, z); const c0 = palette[(R() * 2) | 0], v = 0.88 + R() * 0.24;
    parts.push({ g: ig, flat: true, c: (px, py) => { const t = clamp((py - (y - r)) / (2 * r), 0, 1), l = 0.75 + 0.5 * t; return [c0[0] * v * l, c0[1] * v * l, c0[2] * v * l]; } });
  }
  return mergeGeos(parts);
}
function makeStump() {
  const c = new THREE.CylinderGeometry(0.85, 1.15, 0.8, 9, 1), top = new THREE.CircleGeometry(0.85, 9); top.rotateX(-Math.PI / 2); top.translate(0, 0.4, 0);
  const cc = new THREE.CylinderGeometry(0.85, 1.15, 0.8, 9, 1); cc.translate(0, 0.4, 0); c.translate(0, 0.4, 0);
  return mergeGeos([{ g: cc, c: [0.27, 0.19, 0.12] }, { g: top, c: [0.68, 0.52, 0.32] }]);
}
function makeBush(berries) {
  const R = mulberry32(31), parts = [];
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU, r = 0.5 + R() * 0.35, ig = new THREE.IcosahedronGeometry(r, 1);
    ig.translate(Math.cos(a) * 0.55, 0.45 + R() * 0.35, Math.sin(a) * 0.55);
    const v = 0.8 + R() * 0.4; parts.push({ g: ig, flat: true, c: (x, y) => [0.14 * v * (0.7 + y * 0.5), 0.36 * v * (0.7 + y * 0.5), 0.1 * v] });
  }
  const c0 = new THREE.IcosahedronGeometry(0.7, 1); c0.translate(0, 0.6, 0); parts.push({ g: c0, flat: true, c: [0.16, 0.34, 0.11] });
  if (berries) {
    const bg = new THREE.SphereGeometry(0.1, 6, 5);
    for (let i = 0; i < 14; i++) { const a = R() * TAU, hh = 0.35 + R() * 0.6, rr = 0.9 - hh * 0.25 + R() * 0.15; parts.push({ g: bg, m: mat4(Math.cos(a) * rr, hh, Math.sin(a) * rr, 0, 0, 0, 1, 1, 1), c: [0.82, 0.08, 0.16] }); }
  }
  return mergeGeos(parts);
}
function makePebble() { const g = new THREE.IcosahedronGeometry(0.22, 0); g.scale(1, 0.65, 1.1); g.translate(0, 0.12, 0); return mergeGeos([{ g, flat: true, c: [0.62, 0.62, 0.6] }]); }
function makeStick() {
  const c = new THREE.CylinderGeometry(0.035, 0.05, 1.0, 5, 1); c.rotateZ(Math.PI / 2); c.translate(0, 0.06, 0);
  const b = new THREE.CylinderGeometry(0.02, 0.03, 0.3, 4, 1); b.translate(0, 0.15, 0);
  return mergeGeos([{ g: c, c: [0.42, 0.3, 0.19] }, { g: b, m: new THREE.Matrix4().makeTranslation(0.1, 0.06, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.9)), c: [0.4, 0.28, 0.18] }]);
}
function makeAcornGeo() {
  const body = new THREE.SphereGeometry(0.35, 12, 10); body.scale(1, 1.25, 1); body.translate(0, 0.45, 0);
  const cap = new THREE.SphereGeometry(0.38, 12, 6, 0, TAU, 0, Math.PI / 2); cap.scale(1, 0.7, 1); cap.translate(0, 0.62, 0);
  return mergeGeos([{ g: body, c: [0.72, 0.5, 0.22] }, { g: cap, c: [0.4, 0.27, 0.13] }]);
}

function makeCactus() {
  const parts = [], main = new THREE.CylinderGeometry(0.9, 1, 5, 8, 1); main.translate(0, 2.5, 0); parts.push({ g: main, flat: true, c: [0.18, 0.44, 0.2] });
  const cap = new THREE.SphereGeometry(0.9, 8, 5, 0, TAU, 0, Math.PI / 2); cap.translate(0, 5, 0); parts.push({ g: cap, flat: true, c: [0.2, 0.48, 0.22] });
  for (const [sg, y] of [[1, 2.4], [-1, 3.3]]) {
    const arm = new THREE.CylinderGeometry(0.5, 0.5, 1.4, 7, 1); arm.rotateZ(Math.PI / 2); arm.translate(sg * 1.3, y, 0); parts.push({ g: arm, flat: true, c: [0.17, 0.42, 0.19] });
    const up = new THREE.CylinderGeometry(0.45, 0.5, 1.6, 7, 1); up.translate(sg * 2.0, y + 0.8, 0); parts.push({ g: up, flat: true, c: [0.19, 0.46, 0.21] });
  }
  return mergeGeos(parts);
}
const G = {
  cactus: makeCactus(), grass: makeGrassGeo([0.11, 0.24, 0.07], [0.5, 0.72, 0.2], 0.055), fiber: makeGrassGeo([0.55, 0.6, 0.22], [0.9, 0.92, 0.5], 0.08),
  fern: makeFernGeo(), mushRed: makeMushroom('red'), mushBrown: makeMushroom('brown'), mushTan: makeMushroom('tan', 3),
  leaf: makeLeafGeo(), twig: makeTwigGeo(), rocks: [makeRock(3), makeRock(9)], rockNode: [makeRock(13), makeRock(17)], oreNode: makeRock(23, true),
  flowerBell: makeFlower('bell'), flowerStar: makeFlower('star'), log: makeLogGeo(), acorn: makeAcornGeo(),
  giant: [makeGiantTrunk(1), makeGiantTrunk(2), makeGiantTrunk(3)],
  trees: [makeSpruce(1), makeSpruce(2), makeBroad(3, 0), makeBroad(4, 1), makeBroad(5, 2)],
  stump: makeStump(), bush: makeBush(false), bushBerry: makeBush(true), pebble: makePebble(), stick: makeStick()
};
function swayMat(mat, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nfloat ph = 0.0;\n#ifdef USE_INSTANCING\nph = instanceMatrix[3].x*0.21 + instanceMatrix[3].z*0.17;\n#endif\nfloat hh = max(position.y, 0.0);\n' +
      'transformed.x += sin(uTime*1.7+ph)*' + amp.toFixed(3) + '*hh*hh*0.12 + sin(uTime*0.6+ph*2.0)*0.02*hh;\ntransformed.z += cos(uTime*1.3+ph*1.4)*' + amp.toFixed(3) + '*hh*hh*0.1;');
  };
  mat.customProgramCacheKey = () => 'sway' + amp; return mat;
}
const MAT = {
  ground: new THREE.MeshStandardMaterial({ map: ground.map, normalMap: ground.normal, vertexColors: true, roughness: 1, metalness: 0 }),
  grass: swayMat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 1.0),
  fern: swayMat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.6),
  vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
  vc2: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  ore: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a1204 }),
  voxel: new THREE.MeshStandardMaterial({ map: atlasTex, vertexColors: true, roughness: 0.97, metalness: 0 }),
  glow: new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true }),
  water: new THREE.MeshStandardMaterial({ map: waterTex, color: 0xcfeaff, transparent: true, opacity: 0.72, roughness: 0.1, metalness: 0.05, depthWrite: false }),
  vcTan: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xe6c88e })
};
MAT.ground.normalScale.set(1.3, 1.3);

/* ================= items, recipes ================= */
const ITEMS = {};
function def(id, o) { ITEMS[id] = Object.assign({ id, stack: 64 }, o); }
def('wood', { n: 'Wood', k: 'res' }); def('stick', { n: 'Stick', k: 'res' }); def('stone', { n: 'Stone', k: 'block', bid: B.STONE }); def('fiber', { n: 'Plant fiber', k: 'res' });
def('ore', { n: 'Iron ore', k: 'res' }); def('ingot', { n: 'Iron ingot', k: 'res' }); def('shell', { n: 'Beetle shell', k: 'res' });
def('plank', { n: 'Plank', k: 'block', bid: B.PLANK }); def('brick', { n: 'Stone brick', k: 'block', bid: B.BRICK }); def('dirt', { n: 'Dirt', k: 'block', bid: B.DIRT });
def('sand', { n: 'Sand', k: 'block', bid: B.SAND }); def('gravel', { n: 'Gravel', k: 'block', bid: B.GRAVEL }); def('snow', { n: 'Snow', k: 'block', bid: B.SNOW }); def('crystal', { n: 'Glow crystal', k: 'block', bid: B.CRYSTAL });
def('coal', { n: 'Coal', k: 'res' }); def('torch', { n: 'Torch', k: 'station', place: 'torch', stack: 32 }); def('ladder', { n: 'Ladder', k: 'station', place: 'ladder', stack: 32 });
def('meat', { n: 'Raw meat', k: 'food', food: 12, heal: 0, stack: 16 }); def('cmeat', { n: 'Roasted meat', k: 'food', food: 55, heal: 15, stack: 16 });
def('berries', { n: 'Berries', k: 'food', food: 14, heal: 2, stack: 32 }); def('mushroom', { n: 'Mushroom', k: 'food', food: 9, heal: 0, stack: 32 });
def('cmush', { n: 'Roasted mushroom', k: 'food', food: 34, heal: 12, stack: 32 }); def('bandage', { n: 'Bandage', k: 'food', food: 0, heal: 35, stack: 16 });
def('workbench', { n: 'Workbench', k: 'station', place: 'bench', stack: 4 }); def('furnace', { n: 'Furnace', k: 'station', place: 'furnace', stack: 4 });
def('campfire', { n: 'Campfire', k: 'station', place: 'camp', stack: 8 }); def('bed', { n: 'Bed', k: 'station', place: 'bed', stack: 2 });
const TIERN = ['', 'Wooden', 'Stone', 'Iron'], DUR = { tool: [0, 45, 100, 260], shield: [0, 60, 120, 260] };
const DMG = { sword: [0, 7, 11, 17], axe: [0, 5, 7, 10], pick: [0, 4, 6, 8], shovel: [0, 4, 6, 8] }, CHOP = [1, 2.2, 3.6, 5.8], MINE = [0, 1.6, 3.0, 5.2], DIGP = [0, 2.2, 3.6, 5.8], BLOCKR = [0, 0.6, 0.75, 0.9];
const TP = ['', 'w', 's', 'i'];
for (let t = 1; t <= 3; t++) {
  def(TP[t] + 'axe', { n: TIERN[t] + ' axe', k: 'tool', tool: 'axe', tier: t, dur: DUR.tool[t], stack: 1 });
  def(TP[t] + 'pick', { n: TIERN[t] + ' pickaxe', k: 'tool', tool: 'pick', tier: t, dur: DUR.tool[t], stack: 1 });
  def(TP[t] + 'shovel', { n: TIERN[t] + ' shovel', k: 'tool', tool: 'shovel', tier: t, dur: DUR.tool[t], stack: 1 });
  def(TP[t] + 'sword', { n: TIERN[t] + ' sword', k: 'tool', tool: 'sword', tier: t, dur: DUR.tool[t], stack: 1 });
  def(TP[t] + 'shield', { n: TIERN[t] + ' shield', k: 'shield', tier: t, dur: DUR.shield[t], reduce: BLOCKR[t], stack: 1 });
}
def('cshield', { n: 'Carapace shield', k: 'shield', tier: 4, dur: 150, reduce: 0.85, stack: 1 });
const BDEF = {
  bench: { hp: 6, tool: 'axe', item: 'workbench', st: 1 }, furnace: { hp: 9, tool: 'pick', item: 'furnace', st: 1 },
  camp: { hp: 3, tool: 'axe', item: 'campfire', st: 1 }, bed: { hp: 4, tool: 'axe', item: 'bed', st: 1 }, torch: { hp: 1, tool: 'axe', item: 'torch', st: 1, ns: 1 }, ladder: { hp: 1, tool: 'axe', item: 'ladder', st: 1, ns: 1 }
};
/* voxel block table: tiles are cells in the texture atlas */
const TL = { DIRT: 0, LITTER_SIDE: 1, STONE: 2, IRON: 3, COAL: 4, BEDROCK: 5, SAND: 6, SANDSTONE: 7, SNOW: 8, SNOW_SIDE: 9, GRAVEL: 10, GRASS: 11, GRASS_SIDE: 12, LAVA: 14, CRYSTAL: 15, PLANK: 16, BRICK: 17 };
const BLOCK = [];
function bdef(id, o) { BLOCK[id] = Object.assign({ solid: true, opq: true, hp: 3, tool: 'shovel', need: 0, drop: null, top: 0, side: 0, bot: 0, mesh: 'atlas', n: '' }, o); }
const all = t => ({ top: t, side: t, bot: t });
bdef(B.AIR, { solid: false, opq: false, hp: 0 });
bdef(B.GRASS, { n: 'Forest floor', drop: 'dirt', top: TL.DIRT, side: TL.LITTER_SIDE, bot: TL.DIRT });
bdef(B.DIRT, Object.assign({ n: 'Dirt', drop: 'dirt' }, all(TL.DIRT)));
bdef(B.STONE, Object.assign({ n: 'Stone', hp: 8, tool: 'pick', need: 1, drop: 'stone' }, all(TL.STONE)));
bdef(B.IRON, Object.assign({ n: 'Iron ore', hp: 12, tool: 'pick', need: 2, drop: 'ore' }, all(TL.IRON)));
bdef(B.COAL, Object.assign({ n: 'Coal', hp: 9, tool: 'pick', need: 1, drop: 'coal' }, all(TL.COAL)));
bdef(B.BEDROCK, Object.assign({ n: 'Bedrock', hp: Infinity, tool: 'pick', need: 9 }, all(TL.BEDROCK)));
bdef(B.SAND, Object.assign({ n: 'Sand', hp: 2.5, drop: 'sand' }, all(TL.SAND)));
bdef(B.SANDSTONE, Object.assign({ n: 'Sandstone', hp: 6, tool: 'pick', need: 1, drop: 'stone' }, all(TL.SANDSTONE)));
bdef(B.SNOW, { n: 'Snow', hp: 1.5, drop: 'snow', top: TL.SNOW, side: TL.SNOW_SIDE, bot: TL.DIRT });
bdef(B.GRAVEL, Object.assign({ n: 'Gravel', hp: 3, drop: 'gravel' }, all(TL.GRAVEL)));
bdef(B.MEADOW, { n: 'Grass', drop: 'dirt', top: TL.GRASS, side: TL.GRASS_SIDE, bot: TL.DIRT });
bdef(B.WATER, { n: 'Water', solid: false, opq: false, hp: 0, mesh: 'water' });
bdef(B.LAVA, Object.assign({ n: 'Lava', solid: false, opq: true, hp: 0, mesh: 'glow' }, all(TL.LAVA)));
bdef(B.CRYSTAL, Object.assign({ n: 'Glow crystal', hp: 4, tool: 'pick', need: 1, drop: 'crystal', mesh: 'glow' }, all(TL.CRYSTAL)));
bdef(B.PLANK, Object.assign({ n: 'Plank', hp: 5, tool: 'axe', drop: 'plank' }, all(TL.PLANK)));
bdef(B.BRICK, Object.assign({ n: 'Stone brick', hp: 9, tool: 'pick', drop: 'brick' }, all(TL.BRICK)));
const SOLIDB = BLOCK.map(b => !!(b && b.solid)), OPQ = BLOCK.map(b => !!(b && b.opq));
const BCOL = { 1: 0x6b5638, 2: 0x7a5a3a, 3: 0xa0a0a0, 4: 0xd9762a, 5: 0x2a2a2e, 6: 0x444448, 7: 0xdccb8b, 8: 0xcdb377, 9: 0xf2f6fa, 10: 0x8a8a8a, 11: 0x5f9d3a, 14: 0x5fe0ff, 15: 0xb98450, 16: 0x8f9296 };
const RECIPES = [
  { cat: 'Basics', out: 'stick', n: 4, in: { wood: 1 } }, { cat: 'Basics', out: 'plank', n: 2, in: { wood: 1 } },
  { cat: 'Basics', out: 'bandage', n: 1, in: { fiber: 3 } }, { cat: 'Basics', out: 'workbench', n: 1, in: { plank: 4 } },
  { cat: 'Basics', out: 'campfire', n: 1, in: { wood: 3, stone: 3 } }, { cat: 'Basics', out: 'torch', n: 4, in: { coal: 1, stick: 1 } }, { cat: 'Basics', out: 'ladder', n: 3, in: { stick: 5 } },
  { cat: 'Tools', st: 'bench', out: 'waxe', n: 1, in: { plank: 3, stick: 2 } }, { cat: 'Tools', st: 'bench', out: 'wpick', n: 1, in: { plank: 3, stick: 2 } },
  { cat: 'Tools', st: 'bench', out: 'saxe', n: 1, in: { stone: 3, stick: 2, fiber: 1 } }, { cat: 'Tools', st: 'bench', out: 'spick', n: 1, in: { stone: 3, stick: 2, fiber: 1 } },
  { cat: 'Tools', st: 'bench', out: 'iaxe', n: 1, in: { ingot: 3, stick: 2 } }, { cat: 'Tools', st: 'bench', out: 'ipick', n: 1, in: { ingot: 3, stick: 2 } },
  { cat: 'Tools', st: 'bench', out: 'wshovel', n: 1, in: { plank: 1, stick: 2 } }, { cat: 'Tools', st: 'bench', out: 'sshovel', n: 1, in: { stone: 1, stick: 2 } }, { cat: 'Tools', st: 'bench', out: 'ishovel', n: 1, in: { ingot: 1, stick: 2 } },
  { cat: 'Weapons', st: 'bench', out: 'wsword', n: 1, in: { plank: 2, stick: 1 } }, { cat: 'Weapons', st: 'bench', out: 'ssword', n: 1, in: { stone: 2, stick: 1, fiber: 1 } },
  { cat: 'Weapons', st: 'bench', out: 'isword', n: 1, in: { ingot: 2, stick: 1 } },
  { cat: 'Shields', st: 'bench', out: 'wshield', n: 1, in: { plank: 5, fiber: 1 } }, { cat: 'Shields', st: 'bench', out: 'sshield', n: 1, in: { plank: 2, stone: 4 } },
  { cat: 'Shields', st: 'bench', out: 'ishield', n: 1, in: { ingot: 5, plank: 1 } }, { cat: 'Shields', st: 'bench', out: 'cshield', n: 1, in: { shell: 4, plank: 1, fiber: 2 } },
  { cat: 'Building', st: 'bench', out: 'brick', n: 3, in: { stone: 2 } }, { cat: 'Building', st: 'bench', out: 'furnace', n: 1, in: { stone: 8 } },
  { cat: 'Building', st: 'bench', out: 'bed', n: 1, in: { plank: 3, fiber: 4 } },
  { cat: 'Furnace and fire', st: 'furnace', out: 'ingot', n: 1, in: { ore: 1, wood: 1 } }, { cat: 'Furnace and fire', st: 'furnace', out: 'ingot', n: 2, in: { ore: 2, coal: 1 } }, { cat: 'Furnace and fire', st: 'camp', out: 'cmush', n: 1, in: { mushroom: 1 } }, { cat: 'Furnace and fire', st: 'camp', out: 'cmeat', n: 1, in: { meat: 1 } }
];
const STN = { bench: 'a workbench', furnace: 'a furnace', camp: 'a campfire' };

/* icons drawn by hand on small canvases */
const iconCache = {};
function icon(id) {
  if (iconCache[id]) return iconCache[id];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), d = ITEMS[id];
  const tc = { 1: '#b58a55', 2: '#9a9c9f', 3: '#d5dbe2', 4: '#5a3f86' }[d.tier || 1];
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (x1, y1, x2, y2, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  const poly = (pts, col, stroke) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fillStyle = col; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } };
  const circ = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  if (d.tool === 'axe') { line(14, 54, 42, 16, 6, '#7a5230'); poly([[36, 8], [58, 16], [52, 34], [42, 26], [40, 18]], tc, '#2b2118'); }
  else if (d.tool === 'pick') { line(14, 54, 42, 16, 6, '#7a5230'); g.strokeStyle = tc; g.lineWidth = 8; g.beginPath(); g.moveTo(20, 20); g.quadraticCurveTo(44, -2, 60, 26); g.stroke(); }
  else if (d.tool === 'shovel') { line(14, 56, 38, 22, 6, '#7a5230'); poly([[36, 4], [58, 14], [52, 34], [30, 22]], tc, '#2b2118'); line(34, 12, 50, 26, 2, 'rgba(255,255,255,.35)'); }
  else if (d.tool === 'sword') { line(16, 48, 52, 12, 8, tc); line(16, 48, 52, 12, 2, 'rgba(255,255,255,.55)'); line(14, 38, 30, 54, 6, '#7a5230'); line(10, 54, 20, 44, 6, '#4a3020'); }
  else if (d.k === 'shield') { poly([[32, 5], [55, 13], [54, 38], [32, 60], [10, 38], [9, 13]], id === 'cshield' ? '#33254d' : tc, '#2b2118'); if (id === 'wshield') { line(21, 10, 21, 46, 2, '#5a3a1a'); line(43, 10, 43, 46, 2, '#5a3a1a'); } circ(32, 30, 8, id === 'cshield' ? '#8f6bd6' : '#d8b04a'); circ(32, 30, 4, 'rgba(0,0,0,.25)'); }
  else switch (id) {
    case 'wood': poly([[10, 22], [54, 22], [54, 46], [10, 46]], '#7b5330', '#2b1a0c'); g.fillStyle = '#c99a5a'; g.beginPath(); g.ellipse(54, 34, 5, 12, 0, 0, TAU); g.fill(); g.strokeStyle = '#8a5a2a'; g.beginPath(); g.ellipse(54, 34, 2.5, 6, 0, 0, TAU); g.stroke(); break;
    case 'stick': line(12, 52, 52, 12, 6, '#7a5230'); line(30, 34, 44, 40, 3, '#7a5230'); break;
    case 'plank': for (let i = 0; i < 3; i++) poly([[8, 12 + i * 16], [56, 12 + i * 16], [56, 24 + i * 16], [8, 24 + i * 16]], i % 2 ? '#c69258' : '#b98450', '#5a3a1a'); break;
    case 'stone': poly([[10, 44], [16, 22], [34, 12], [52, 22], [56, 42], [36, 54]], '#8d8f93', '#3a3b3d'); poly([[22, 24], [34, 16], [44, 24], [30, 30]], '#b4b6ba'); break;
    case 'ladder': line(18, 6, 18, 58, 6, '#9a6a3a'); line(46, 6, 46, 58, 6, '#9a6a3a'); for (let q = 0; q < 5; q++) line(18, 12 + q * 11, 46, 12 + q * 11, 5, '#b98450'); break;
    case 'meat': case 'cmeat': g.fillStyle = id === 'meat' ? '#d9707a' : '#8a4a2a'; g.beginPath(); g.ellipse(28, 26, 20, 16, -0.4, 0, TAU); g.fill(); g.fillStyle = id === 'meat' ? '#f0a0a8' : '#b5703e'; g.beginPath(); g.ellipse(24, 22, 9, 6, -0.4, 0, TAU); g.fill(); line(38, 38, 52, 54, 7, '#efe6cf'); circ(54, 56, 5, '#efe6cf'); break;
    case 'coal': poly([[10, 44], [16, 22], [34, 12], [52, 22], [56, 42], [36, 54]], '#2a2a2e', '#0d0d10'); poly([[22, 24], [34, 17], [42, 25], [30, 30]], '#5a5a64'); break;
    case 'sand': poly([[6, 10], [58, 10], [58, 56], [6, 56]], '#dccb8b', '#8a7a48'); for (let q = 0; q < 14; q++) circ(10 + (q * 31) % 46, 14 + (q * 19) % 40, 1.6, q % 2 ? '#b9a765' : '#efe0a4'); break;
    case 'gravel': poly([[6, 10], [58, 10], [58, 56], [6, 56]], '#7d7d7f', '#3a3a3c'); for (let q = 0; q < 9; q++) circ(12 + (q * 29) % 42, 16 + (q * 17) % 36, 4 + q % 3, q % 2 ? '#a4a4a8' : '#5a5a5d'); break;
    case 'snow': poly([[6, 10], [58, 10], [58, 56], [6, 56]], '#eef3f8', '#9db0c4'); poly([[6, 10], [58, 10], [58, 20], [6, 20]], '#ffffff'); break;
    case 'crystal': poly([[32, 4], [50, 28], [32, 60], [14, 28]], '#4fd6f2', '#1a6a86'); poly([[32, 4], [50, 28], [32, 30]], '#b8f6ff'); poly([[32, 30], [50, 28], [32, 60]], '#2a9ab8'); break;
    case 'torch': line(32, 58, 32, 26, 7, '#7a5230'); g.fillStyle = '#ffb02e'; g.beginPath(); g.moveTo(32, 4); g.quadraticCurveTo(46, 20, 40, 30); g.quadraticCurveTo(32, 34, 24, 30); g.quadraticCurveTo(18, 20, 32, 4); g.fill(); g.fillStyle = '#ffe58a'; g.beginPath(); g.moveTo(32, 16); g.quadraticCurveTo(38, 26, 32, 30); g.quadraticCurveTo(26, 26, 32, 16); g.fill(); break;
    case 'dirt': poly([[6, 10], [58, 10], [58, 56], [6, 56]], '#6b5034', '#2b1c0e'); poly([[6, 10], [58, 10], [58, 22], [6, 22]], '#8a5a2a'); for (let q = 0; q < 12; q++) circ(10 + (q * 37) % 46, 26 + (q * 23) % 28, 2, q % 2 ? '#4a3622' : '#93754a'); break;
    case 'brick': for (let r = 0; r < 3; r++) for (let b = 0; b < 2; b++) poly([[6 + b * 26 + (r % 2 ? 13 : 0), 10 + r * 16], [30 + b * 26 + (r % 2 ? 13 : 0), 10 + r * 16], [30 + b * 26 + (r % 2 ? 13 : 0), 24 + r * 16], [6 + b * 26 + (r % 2 ? 13 : 0), 24 + r * 16]], '#8f9296', '#3a3b3d'); break;
    case 'fiber': for (let i = 0; i < 5; i++) { g.strokeStyle = i % 2 ? '#c9d67a' : '#9bb14a'; g.lineWidth = 4; g.beginPath(); g.moveTo(32, 56); g.quadraticCurveTo(14 + i * 9, 30, 6 + i * 13, 8 + (i % 2) * 8); g.stroke(); } break;
    case 'berries': circ(22, 40, 11, '#c0223a'); circ(42, 38, 11, '#d92a44'); circ(32, 22, 11, '#a91c33'); line(32, 12, 36, 4, 3, '#3f7a2a'); break;
    case 'mushroom': case 'cmush': g.fillStyle = id === 'cmush' ? '#8a4a1e' : '#c9a066'; g.beginPath(); g.ellipse(32, 28, 24, 16, 0, Math.PI, 0); g.fill(); poly([[26, 28], [38, 28], [40, 54], [24, 54]], '#efe6cf', '#7a6a4a'); if (id === 'cmush') { circ(24, 22, 3, '#5a2c0e'); circ(40, 20, 3, '#5a2c0e'); } break;
    case 'ore': poly([[10, 44], [16, 22], [34, 12], [52, 22], [56, 42], [36, 54]], '#6f7175', '#2a2b2d'); circ(24, 32, 5, '#d9762a'); circ(40, 26, 4, '#e88a3a'); circ(38, 42, 5, '#c9601c'); break;
    case 'ingot': poly([[8, 44], [20, 22], [50, 22], [58, 44]], '#e3e8ee', '#4a5058'); poly([[8, 44], [58, 44], [58, 52], [8, 52]], '#a9b0b8', '#4a5058'); break;
    case 'shell': g.fillStyle = '#33254d'; g.beginPath(); g.ellipse(32, 34, 24, 18, 0, 0, TAU); g.fill(); g.strokeStyle = '#8f6bd6'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 16); g.lineTo(32, 52); g.stroke(); g.beginPath(); g.ellipse(32, 34, 24, 18, 0, 0, TAU); g.stroke(); break;
    case 'bandage': poly([[8, 22], [56, 22], [56, 42], [8, 42]], '#f1ece0', '#7a746a'); line(32, 26, 32, 38, 5, '#d9483b'); line(26, 32, 38, 32, 5, '#d9483b'); break;
    case 'workbench': poly([[6, 26], [58, 26], [58, 34], [6, 34]], '#c69258', '#4a2f14'); line(12, 34, 12, 56, 6, '#8a5a2a'); line(52, 34, 52, 56, 6, '#8a5a2a'); line(20, 20, 34, 20, 4, '#9aa0a8'); break;
    case 'furnace': poly([[8, 12], [56, 12], [56, 58], [8, 58]], '#8c8e92', '#33343a'); poly([[20, 32], [44, 32], [44, 54], [20, 54]], '#1a1210'); poly([[26, 42], [38, 42], [38, 54], [26, 54]], '#f08a2a'); break;
    case 'campfire': line(10, 52, 54, 40, 7, '#6b4526'); line(10, 40, 54, 52, 7, '#7b5330'); g.fillStyle = '#f7a233'; g.beginPath(); g.moveTo(32, 6); g.quadraticCurveTo(52, 30, 40, 42); g.quadraticCurveTo(32, 46, 24, 42); g.quadraticCurveTo(14, 30, 32, 6); g.fill(); g.fillStyle = '#ffe07a'; g.beginPath(); g.moveTo(32, 24); g.quadraticCurveTo(42, 38, 32, 44); g.quadraticCurveTo(22, 38, 32, 24); g.fill(); break;
    case 'bed': poly([[6, 34], [58, 34], [58, 50], [6, 50]], '#8a5a2a', '#3a2410'); poly([[8, 26], [58, 26], [58, 36], [8, 36]], '#c9483b', '#5a1a14'); poly([[10, 20], [28, 20], [28, 30], [10, 30]], '#f4efe4', '#7a746a'); break;
    default: circ(32, 32, 16, '#999');
  }
  return iconCache[id] = c.toDataURL();
}

/* ================= inventory ================= */
const inv = new Array(24).fill(null);
let sel = 0, swapFrom = null, uiOpen = false;
function addItem(id, n) {
  const d = ITEMS[id];
  if (d.stack > 1) for (let i = 0; i < 24 && n > 0; i++) { const s = inv[i]; if (s && s.id === id && s.n < d.stack) { const t = Math.min(n, d.stack - s.n); s.n += t; n -= t; } }
  for (let i = 0; i < 24 && n > 0; i++) if (!inv[i]) { const t = Math.min(n, d.stack); inv[i] = { id, n: t, dur: d.dur }; n -= t; }
  renderHot(); if (uiOpen) renderInv();
  return n;
}
function countItem(id) { let c = 0; for (const s of inv) if (s && s.id === id) c += s.n; return c; }
function removeItems(id, n) { for (let i = 23; i >= 0 && n > 0; i--) { const s = inv[i]; if (s && s.id === id) { const t = Math.min(n, s.n); s.n -= t; n -= t; if (s.n <= 0) inv[i] = null; } } }
function canHold(id, n) {
  const d = ITEMS[id]; let room = 0;
  for (const s of inv) { if (!s) room += d.stack; else if (s.id === id) room += d.stack - s.n; }
  return room >= n;
}
function bestShield() { let b = null; for (const s of inv) if (s && ITEMS[s.id].k === 'shield' && (!b || ITEMS[s.id].reduce > ITEMS[b.id].reduce)) b = s; return b; }

function slotEl(s, i, hot) {
  const el = document.createElement('div'); el.className = 'slot' + (hot && i === sel ? ' sel' : '') + (swapFrom === i ? ' pick' : '');
  if (hot) { const k = document.createElement('div'); k.className = 'k'; k.textContent = i + 1; el.appendChild(k); }
  if (s) {
    const im = document.createElement('img'); im.src = icon(s.id); el.appendChild(im); el.title = ITEMS[s.id].n;
    if (s.n > 1) { const n = document.createElement('div'); n.className = 'n'; n.textContent = s.n; el.appendChild(n); }
    const d = ITEMS[s.id]; if (d.dur) { const b = document.createElement('div'); b.className = 'd'; b.innerHTML = '<i style="width:' + Math.round(s.dur / d.dur * 100) + '%"></i>'; el.appendChild(b); }
  }
  el.addEventListener('click', () => {
    if (hot && !uiOpen) { sel = i; renderHot(); updateHeld(); return; }
    if (swapFrom === null) { if (s) swapFrom = i; } else { const t = inv[swapFrom]; inv[swapFrom] = inv[i]; inv[i] = t; swapFrom = null; updateHeld(); }
    renderHot(); renderInv();
  });
  return el;
}
function renderHot() {
  const hb = $('hotbar'); hb.innerHTML = '';
  for (let i = 0; i < 8; i++) hb.appendChild(slotEl(inv[i], i, true));
}
function stationNear(t) {
  for (const b of stations) if (b.t === t && Math.hypot(b.i + 0.5 - P.x, b.k + 0.5 - P.z) < 7 && Math.abs(b.j - P.y) < 4) return true;
  return false;
}
function renderInv() {
  if (!uiOpen) return;
  const grid = $('grid'); grid.innerHTML = '';
  for (let i = 0; i < 24; i++) grid.appendChild(slotEl(inv[i], i, false));
  const pills = $('pills'); pills.innerHTML = '';
  for (const [t, n] of [['bench', 'Workbench'], ['furnace', 'Furnace'], ['camp', 'Campfire']]) {
    const p = document.createElement('span'); const on = stationNear(t); p.className = 'pill' + (on ? ' on' : ''); p.textContent = n + (on ? ' nearby' : ' not near'); pills.appendChild(p);
  }
  const list = $('recipes'), keep = list.scrollTop; list.innerHTML = ''; let cat = '';
  for (const r of RECIPES) {
    if (r.cat !== cat) { cat = r.cat; const h = document.createElement('h3'); h.textContent = cat; list.appendChild(h); }
    const stOK = !r.st || stationNear(r.st); let haveAll = true, txt = '';
    for (const k in r.in) { const have = countItem(k), ok = have >= r.in[k]; if (!ok) haveAll = false; txt += '<i class="' + (ok ? 'have' : 'lack') + '">' + ITEMS[k].n + ' ' + Math.min(have, 99) + '/' + r.in[k] + '</i>'; }
    if (r.st) txt += '<i class="' + (stOK ? 'have' : 'lack') + '">needs ' + STN[r.st] + '</i>';
    const row = document.createElement('div'); row.className = 'rec' + (haveAll && stOK ? ' ok' : '');
    row.innerHTML = '<img src="' + icon(r.out) + '"><div class="rt"><b>' + ITEMS[r.out].n + (r.n > 1 ? ' x' + r.n : '') + '</b><span>' + txt + '</span></div>';
    const b = document.createElement('button'); b.textContent = 'Craft'; b.disabled = !(haveAll && stOK);
    b.addEventListener('click', () => craft(r)); row.appendChild(b); list.appendChild(row);
  }
  list.scrollTop = keep;
}
function craft(r) {
  if (r.st && !stationNear(r.st)) return;
  for (const k in r.in) if (countItem(k) < r.in[k]) return;
  if (!canHold(r.out, r.n)) { toast('Your pack is full', true); return; }
  for (const k in r.in) removeItems(k, r.in[k]);
  addItem(r.out, r.n); sfx.craft(); toast('Crafted ' + ITEMS[r.out].n, false, 1400); updateHeld();
  if (r.out.endsWith('shovel')) tip('shovel', 'Left click the ground to dig. Dig down to burrow, and place dirt to reshape the land.');
  if (r.out === 'workbench') tip('bench', 'Place the workbench, then craft tools and weapons next to it.');
}
function toggleInv(force) {
  uiOpen = force !== undefined ? force : !uiOpen;
  $('inv').classList.toggle('hidden', !uiOpen); swapFrom = null;
  if (uiOpen) { if (document.exitPointerLock) document.exitPointerLock(); for (const k in keys) keys[k] = false; mouseHeld = false; }
  renderInv(); renderHot();
}

/* ================= blocks, stations and the voxel world ================= */
const blocks = new Map(), stations = [];   // stations and torches only; terrain and placed cubes are voxels in the chunk data
const key = (i, j, k) => i + ',' + j + ',' + k;
const chunkData = new Map(), edits = new Map();
function cdata(cx, cz) { const k = cx + ',' + cz; let d = chunkData.get(k); if (!d) { d = WG.genChunk(cx, cz); chunkData.set(k, d); } return d; }
let gcx = 1e9, gcz = 1e9, gd = null;
function getBlock(i, j, k) {
  if (j < JMIN) return B.BEDROCK; if (j >= JMAX) return 0;
  const cx = Math.floor((i + S / 2) / S), cz = Math.floor((k + S / 2) / S);
  if (cx !== gcx || cz !== gcz) { gd = cdata(cx, cz).data; gcx = cx; gcz = cz; }
  return gd[(j - JMIN) * SS + (k - (cz * S - S / 2)) * S + (i - (cx * S - S / 2))];
}
function setVox(i, j, k, id) {
  if (j < JMIN || j >= JMAX) return;
  const cx = Math.floor((i + S / 2) / S), cz = Math.floor((k + S / 2) / S), d = cdata(cx, cz), li = i - (cx * S - S / 2), lk = k - (cz * S - S / 2);
  d.data[(j - JMIN) * SS + lk * S + li] = id; if (id !== 0 && j > d.hi[lk * S + li]) d.hi[lk * S + li] = j; edits.set(key(i, j, k), { i, j, k, id });
  for (let di = (li === 0 ? -1 : 0); di <= (li === S - 1 ? 1 : 0); di++) for (let dk = (lk === 0 ? -1 : 0); dk <= (lk === S - 1 ? 1 : 0); dk++) { const ch = chunks.get((cx + di) + ',' + (cz + dk)); if (ch) ch.dirty = true; }
}
function solid(i, j, k) { if (SOLIDB[getBlock(i, j, k)]) return true; if (blocks.size) { const b = blocks.get(key(i, j, k)); return !!b && !b.ns; } return false; }
/* standing height of a column: first free cell above solid ground, honouring dug holes and built blocks */
function surf(x, z) { const i = Math.floor(x), k = Math.floor(z); let j = WG.terr(i, k).h; if (solid(i, j, k)) { while (solid(i, j, k) && j < JMAX - 1) j++; return j; } while (j > JMIN && !solid(i, j - 1, k)) j--; return j; }
function floorY(x, z, y) { const i = Math.floor(x), k = Math.floor(z); let j = Math.floor(y + 1.2); while (j > JMIN && !solid(i, j - 1, k)) j--; return j; }

function buildStation(t) {
  const g = new THREE.Group(), std = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.85 : r, metalness: m || 0 });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
  if (t === 'bench') {
    const wood = std(0xb98450), dark = std(0x6b4526);
    box(0.96, 0.14, 0.96, wood, 0, 0.85, 0); for (const [x, z] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) box(0.12, 0.82, 0.12, dark, x, 0.41, z);
    box(0.8, 0.06, 0.06, dark, 0, 0.3, 0.38); box(0.8, 0.06, 0.06, dark, 0, 0.3, -0.38);
    box(0.36, 0.05, 0.12, std(0x9aa0a8, 0.4, 0.7), -0.2, 0.945, 0.15); box(0.06, 0.16, 0.06, dark, 0.22, 0.99, -0.2).rotation.z = 0.2;
    box(0.22, 0.14, 0.22, std(0x8d5a2a), 0.25, 0.99, 0.25);
  } else if (t === 'furnace') {
    const st = std(0x86888d, 0.95); box(0.98, 0.98, 0.98, st, 0, 0.49, 0); box(0.4, 0.4, 0.4, std(0x76787d), 0.25, 1.18, -0.2);
    box(0.5, 0.42, 0.06, std(0x14100e), 0, 0.42, 0.48); const glow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.04), new THREE.MeshBasicMaterial({ color: 0xff8a2a })); glow.position.set(0, 0.36, 0.5); g.add(glow); g.userData.glow = glow;
  } else if (t === 'camp') {
    const log = std(0x5a3a1e), stone = std(0x7d7f83, 0.95);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), stone); m.position.set(Math.cos(a) * 0.42, 0.1, Math.sin(a) * 0.42); m.scale.y = 0.7; m.castShadow = true; g.add(m); }
    for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 6), log); l.position.y = 0.15; l.rotation.set(Math.PI / 2 - 0.25, i * 2.1, 0); l.castShadow = true; g.add(l); }
    const fm = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.62, 7), fm), f2 = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    f1.position.y = 0.42; f2.position.y = 0.36; g.add(f1); g.add(f2); g.userData.flames = [f1, f2];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowWarm, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 })); sp.scale.setScalar(2.4); sp.position.y = 0.5; g.add(sp); g.userData.glowSp = sp;
  } else if (t === 'ladder') {
    const wd = std(0x9a6a3a); for (const sx of [-0.3, 0.3]) box(0.07, 1.0, 0.07, wd, sx, 0.5, -0.44); for (let q = 0; q < 4; q++) box(0.6, 0.06, 0.06, wd, 0, 0.15 + q * 0.24, -0.44);
  } else if (t === 'torch') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 6), std(0x6b4526)); stick.position.y = 0.35; stick.castShadow = true; g.add(stick);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })); fl.position.y = 0.86; g.add(fl); g.userData.flames = [fl, fl];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowWarm, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 })); sp.scale.setScalar(1.2); sp.position.y = 0.88; g.add(sp); g.userData.glowSp = sp;
  } else if (t === 'bed') {
    box(0.98, 0.3, 0.98, std(0x8a5a2a), 0, 0.15, 0); box(0.92, 0.18, 0.92, std(0xd9d2c0), 0, 0.39, 0); box(0.92, 0.1, 0.6, std(0xb7362d), 0, 0.5, -0.16); box(0.7, 0.14, 0.26, std(0xf4efe4), 0, 0.53, 0.34);
  }
  return g;
}
function placeStation(i, j, k, t) {
  const b = { t, i, j, k, hp: BDEF[t].hp, obj: null, ns: !!BDEF[t].ns }; blocks.set(key(i, j, k), b);
  const o = buildStation(t); o.position.set(i + 0.5, j, k + 0.5); o.rotation.y = Math.round(Math.atan2(P.x - (i + 0.5), P.z - (k + 0.5)) / (Math.PI / 2)) * Math.PI / 2; scene.add(o); b.obj = o; stations.push(b); return b;
}
function removeStation(b) { blocks.delete(key(b.i, b.j, b.k)); if (b.obj) scene.remove(b.obj); const ix = stations.indexOf(b); if (ix >= 0) stations.splice(ix, 1); }
function pushFromBlocks(o, r, yb, yt) {
  const i0 = Math.floor(o.x - r), i1 = Math.floor(o.x + r), k0 = Math.floor(o.z - r), k1 = Math.floor(o.z + r), j0 = Math.floor(yb), j1 = Math.floor(yt - 0.001);
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
    if (!solid(i, j, k)) continue;
    const cx = clamp(o.x, i, i + 1), cz = clamp(o.z, k, k + 1), dx = o.x - cx, dz = o.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2); o.x = cx + dx / d * r; o.z = cz + dz / d * r; }
      else { const lx = o.x - i, rx = i + 1 - o.x, lz = o.z - k, rz = k + 1 - o.z, m = Math.min(lx, rx, lz, rz); if (m === lx) o.x = i - r; else if (m === rx) o.x = i + 1 + r; else if (m === lz) o.z = k - r; else o.z = k + 1 + r; }
    }
  }
}
function surfaceY(x, z, yRef) {
  let s = JMIN; const r = 0.38, jmax = Math.floor(yRef - 0.4 + 1e-4);
  for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let k = Math.floor(z - r); k <= Math.floor(z + r); k++) {
    const cx = clamp(x, i, i + 1), cz = clamp(z, k, k + 1); if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > r * r) continue;
    for (let j = jmax; j >= JMIN - 1; j--) if (solid(i, j, k)) { s = Math.max(s, j + 1); break; }
  }
  return s;
}
function ceilingAt(x, z, y0, y1) {
  const r = 0.36;
  for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let k = Math.floor(z - r); k <= Math.floor(z + r); k++)
    for (let j = Math.floor(y0); j <= Math.floor(y1); j++) if (j >= y0 - 1e-3 && solid(i, j, k)) return j;
  return null;
}

/* ================= voxel meshing: hidden faces removed, ambient occlusion per vertex ================= */
const FD = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
];
const UNIT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], AXES = [0, 0, 1, 1, 2, 2], AO_LV = [0.5, 0.68, 0.84, 1];
const BTINT = [[1, 1, 1], [0.86, 1.1, 0.62], [0.82, 0.98, 0.78], [1, 1, 1], [0.58, 0.8, 0.58], [1, 1, 1]];
const TRECT = []; for (let t = 0; t < 24; t++) { const col = t % 8, row = (t / 8) | 0; TRECT.push([col / 8 + 0.004, (col + 1) / 8 - 0.004, 1 - (row + 1) / 3 + 0.004, 1 - row / 3 - 0.004]); }
function makeReader(cx, cz) {
  const arr = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) arr.push(cdata(cx + dx, cz + dz).data);
  const i0 = cx * S - S / 2, k0 = cz * S - S / 2;
  return (i, j, k) => {
    if (j < JMIN) return B.BEDROCK; if (j >= JMAX) return 0;
    const a = i - i0, c = k - k0, ax = a < 0 ? 0 : a >= S ? 2 : 1, ac = c < 0 ? 0 : c >= S ? 2 : 1;
    return arr[ax * 3 + ac][(j - JMIN) * SS + (c - (ac - 1) * S) * S + (a - (ax - 1) * S)];
  };
}
const newBk = () => ({ p: [], n: [], u: [], c: [], i: [] });
function aoOf(rd, i, j, k, dir) {
  const f = FD[dir], ax = AXES[dir], ta = (ax + 1) % 3, tb = (ax + 2) % 3, fx = i + f.n[0], fy = j + f.n[1], fz = k + f.n[2], ea = UNIT[ta], eb = UNIT[tb], out = [0, 0, 0, 0];
  for (let q = 0; q < 4; q++) {
    const c = f.c[q], sa = c[ta] * 2 - 1, sb = c[tb] * 2 - 1;
    const s1 = OPQ[rd(fx + ea[0] * sa, fy + ea[1] * sa, fz + ea[2] * sa)] ? 1 : 0, s2 = OPQ[rd(fx + eb[0] * sb, fy + eb[1] * sb, fz + eb[2] * sb)] ? 1 : 0;
    const s3 = OPQ[rd(fx + ea[0] * sa + eb[0] * sb, fy + ea[1] * sa + eb[1] * sb, fz + ea[2] * sa + eb[2] * sb)] ? 1 : 0;
    out[q] = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
  }
  return out;
}
function pushQuad(Bk, i, j, k, dir, uv, r, g, b, ao, ys) {
  const f = FD[dir], base = Bk.p.length / 3;
  for (let q = 0; q < 4; q++) {
    const c = f.c[q], sh = ao ? AO_LV[ao[q]] : 1;
    Bk.p.push(i + c[0], j + c[1] * ys, k + c[2]); Bk.n.push(f.n[0], f.n[1], f.n[2]); Bk.c.push(r * sh, g * sh, b * sh); Bk.u.push(uv[q][0], uv[q][1]);
  }
  if (ao && ao[1] + ao[3] > ao[0] + ao[2]) Bk.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base); else Bk.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function buildGround(ch) {
  const cx = ch.cx, cz = ch.cz, i0 = cx * S - S / 2, k0 = cz * S - S / 2, rd = makeReader(cx, cz), cd = cdata(cx, cz), data = cd.data;
  const bk = { top: newBk(), atlas: newBk(), glow: newBk(), water: newBk() };
  for (let lk = 0; lk < S; lk++) for (let li = 0; li < S; li++) {
    const col = lk * S + li, i = i0 + li, k = k0 + lk, bt = BTINT[cd.bio[col]], hiJ = cd.hi[col], cvar = 0.94 + hash2(i, k, 9) * 0.12;
    let mossC = null;
    for (let j = JMIN; j <= hiJ; j++) {
      const id = data[(j - JMIN) * SS + col]; if (id === 0) continue;
      const bd = BLOCK[id];
      if (bd.mesh === 'water') {
        for (let dir = 0; dir < 6; dir++) {
          if (dir === 3) continue; const f = FD[dir]; if (rd(i + f.n[0], j + f.n[1], k + f.n[2]) !== 0) continue;
          const uv = []; for (let q = 0; q < 4; q++) { const c = f.c[q]; uv.push([(i + c[0]) / 5, (k + c[2]) / 5]); }
          pushQuad(bk.water, i, j, k, dir, uv, 1, 1, 1, null, 0.9);
        }
        continue;
      }
      for (let dir = 0; dir < 6; dir++) {
        const f = FD[dir], nb = rd(i + f.n[0], j + f.n[1], k + f.n[2]);
        if (id === B.LAVA ? !(nb === 0 || nb === B.WATER) : OPQ[nb]) continue;
        const green = id === B.GRASS || id === B.MEADOW, r = green ? bt[0] * cvar : 1, g = green ? bt[1] * cvar : 1, b = green ? bt[2] * cvar : 1;
        const ao = bd.mesh === 'atlas' ? aoOf(rd, i, j, k, dir) : null;
        if (id === B.GRASS && dir === 2) {
          if (!mossC) { const x = i + 0.5, z = k + 0.5, moss = smooth(0.48, 0.68, fbm(x * 0.045, z * 0.045, 3, 31)), dm = (0.85 + fbm(x * 0.12, z * 0.12, 2, 41) * 0.35) * cvar; mossC = [lerp(1, 0.62, moss) * dm * bt[0], lerp(0.93, 1, moss) * dm * bt[1], lerp(0.82, 0.58, moss) * dm * bt[2]]; }
          pushQuad(bk.top, i, j, k, dir, [[i / TILE, (k + 1) / TILE], [(i + 1) / TILE, (k + 1) / TILE], [(i + 1) / TILE, k / TILE], [i / TILE, k / TILE]], mossC[0], mossC[1], mossC[2], ao, 1);
        } else {
          const u = TRECT[dir === 2 ? bd.top : dir === 3 ? bd.bot : bd.side];
          pushQuad(bd.mesh === 'glow' ? bk.glow : bk.atlas, i, j, k, dir, [[u[0], u[2]], [u[1], u[2]], [u[1], u[3]], [u[0], u[3]]], r, g, b, ao, 1);
        }
      }
    }
  }
  const mk = (Bk, mat, old, cast, order) => {
    if (!Bk.p.length) { if (old) { old.geometry.dispose(); ch.grp.remove(old); } return null; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Bk.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Bk.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(Bk.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(Bk.c, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(Bk.i), 1));
    if (old) { old.geometry.dispose(); old.geometry = g; return old; }
    const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = cast; if (order) m.renderOrder = order; ch.grp.add(m); return m;
  };
  ch.gm.top = mk(bk.top, MAT.ground, ch.gm.top, true); ch.gm.atlas = mk(bk.atlas, MAT.voxel, ch.gm.atlas, true);
  ch.gm.glow = mk(bk.glow, MAT.glow, ch.gm.glow, false); ch.gm.water = mk(bk.water, MAT.water, ch.gm.water, false, 2);
}

/* ================= chunks: scenery, nodes and pickups on top of the voxel meshes ================= */
const deadNodes = new Set(), nk = n => n.x.toFixed(1) + ',' + n.z.toFixed(1);
const chunks = new Map(), collected = new Set(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const GT = [[1, 1, 1], [0.9, 1.25, 0.72], [0.85, 1.0, 0.85], [1.3, 1.1, 0.6], [0.65, 0.92, 0.6], [1, 1, 1]];
/* weight per biome: forest, meadow, highland, dunes, marsh, peaks */
const W = {
  giant: [0.6, 0.1, 0.2, 0, 0.25, 0], log: [0.5, 0.15, 0.2, 0, 0.3, 0], tree: [1, 0.22, 0.8, 0, 0.32, 0], cactus: [0, 0, 0, 0.75, 0, 0], rock: [1, 0.6, 1.6, 1.2, 0.5, 1.5], ore: [0.4, 0.3, 0.6, 0.3, 0.15, 0.7], bush: [1, 1.6, 0.4, 0, 1.2, 0],
  decoRock: [1, 0.7, 1.8, 1.3, 0.5, 1.6], mush: [1, 0.2, 0.2, 0, 1.8, 0], fern: [1, 0.35, 0.5, 0, 1.2, 0], leaf: [1, 0.08, 0.05, 0, 0.4, 0], twig: [1, 0.3, 0.6, 0.2, 0.4, 0], flower: [0.6, 1.7, 0.1, 0, 0.5, 0], grass: [1, 1.4, 0.6, 0.15, 1.1, 0],
  pebble: [1, 1, 2, 1, 0.6, 2], stick: [1, 0.4, 0.7, 0.3, 0.6, 0.1], fiber: [1, 1.6, 0.5, 0.3, 1.4, 0], mushPick: [1, 0.2, 0.2, 0, 1.6, 0]
};
function changedTop(i, k, h) { return !SOLIDB[getBlock(i, h - 1, k)] || getBlock(i, h, k) !== 0; }
function genChunk(cx, cz) {
  const R = mulberry32(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x9e3779b9);
  const x0 = cx * S - S / 2, z0 = cz * S - S / 2, grp = new THREE.Group();
  const ch = { cx, cz, grp, col: [], nodes: [], picks: [], disp: [], scen: [], dirty: false, gm: {} };
  const rx = () => x0 + R() * S, rz = () => z0 + R() * S, home = (x, z, r) => Math.hypot(x, z) < r;
  const bioAt = (x, z) => WG.terr(Math.floor(x), Math.floor(z)).biome;
  const wOK = (w, x, z) => R() < w[bioAt(x, z)];
  const walk = (x, z) => { const i = Math.floor(x), k = Math.floor(z), t = WG.terr(i, k); return t.h > SEA + 1 && WG.slope(i, k) < 3; };
  const blocked = (x, z, pad) => { if (!walk(x, z)) return true; for (const c of ch.col) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true; return false; };
  const align = (x, z, yaw, off, sx, sy, sz) => { dummy.quaternion.setFromAxisAngle(UP, yaw); dummy.position.set(x, H(x, z) + off, z); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); return dummy.matrix.clone(); };
  const flush = (list, geo, mat, cast) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length); m.frustumCulled = false; m.castShadow = !!cast; m.receiveShadow = true;
    for (let i = 0; i < list.length; i++) { m.setMatrixAt(i, list[i].m); tmpC.setRGB(list[i].r, list[i].g, list[i].b); m.setColorAt(i, tmpC); }
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; grp.add(m); ch.disp.push(m);
    const xz = new Float32Array(list.length * 2); for (let q = 0; q < list.length; q++) { xz[q * 2] = list[q].m.elements[12]; xz[q * 2 + 1] = list[q].m.elements[14]; } m.userData.xz = xz; ch.scen.push(m); return m;
  };
  const tint = (a, b) => { const v = a + R() * (b - a); return [v * (0.95 + R() * 0.1), v, v * (0.95 + R() * 0.1)]; };
  buildGround(ch);

  /* giant ancient trunks and fallen logs */
  if (R() < 0.7) {
    const tx = x0 + 9 + R() * (S - 18), tz = z0 + 9 + R() * (S - 18), r = 4.5 + R() * 4;
    if (Math.hypot(tx, tz) > 18 && wOK(W.giant, tx, tz) && walk(tx, tz)) {
      let y0 = 1e9; for (let k = 0; k < 8; k++) y0 = Math.min(y0, H(tx + Math.cos(k * 0.785) * r, tz + Math.sin(k * 0.785) * r));
      const m = new THREE.Mesh(G.giant[(R() * 3) | 0], MAT.vc); m.position.set(tx, y0 - 0.3, tz); m.scale.set(r, 1, r); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
      ch.col.push({ x: tx, z: tz, r: r * 1.12 });
    }
  }
  if (R() < 0.6) {
    const r = 1.2 + R() * 1.1, len = 8 + R() * 8, yaw = R() * TAU, lx = x0 + 10 + R() * (S - 20), lz = z0 + 10 + R() * (S - 20);
    if (!home(lx, lz, len) && wOK(W.log, lx, lz) && !blocked(lx, lz, len * 0.5)) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw), h1 = baseH(lx - fx * len / 2, lz - fz * len / 2, 1), h2 = baseH(lx + fx * len / 2, lz + fz * len / 2, 1);
      const m = new THREE.Mesh(G.log, MAT.vc); m.rotation.order = 'YXZ'; m.rotation.y = yaw; m.rotation.x = -Math.atan2(h2 - h1, len);
      m.position.set(lx, (h1 + h2) / 2 + r * 0.55, lz); m.scale.set(r, r, len); m.castShadow = true; m.receiveShadow = true; grp.add(m);
      const n = Math.ceil(len / (r * 1.4)); for (let k = 0; k < n; k++) { const t = (k / (n - 1) - 0.5) * len * 0.94; ch.col.push({ x: lx + fx * t, z: lz + fz * t, r: r * 0.9 }); }
    }
  }

  /* choppable trees, by biome */
  const forest = (x, z) => 0.3 + 0.7 * smooth(0.3, 0.6, fbm(x * 0.02, z * 0.02, 2, 71));
  for (let a = 0; a < 18; a++) {
    const x = rx(), z = rz(); if (!wOK(W.tree, x, z) || R() > forest(x, z) * 0.85) continue;
    const r = 0.42 + R() * 0.45; if (home(x, z, 7) || blocked(x, z, r + 1.5)) continue;
    const b = bioAt(x, z), v = b === BIOME.HIGHLAND ? (R() < 0.5 ? 0 : 1) : b === BIOME.MEADOW ? 4 : b === BIOME.MARSH ? (R() < 0.5 ? 2 : 4) : (R() * G.trees.length) | 0;
    const m = new THREE.Mesh(G.trees[v], MAT.vc), by = baseH(x, z, r);
    m.position.set(x, by - 0.25, z); m.scale.setScalar(r); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    const node = { kind: 'tree', x, z, y0: by, r, h: (v < 2 ? 22 : 16) * r, hp: 9 + r * 8, max: 9 + r * 8, yield: Math.round(2 + r * 5), mesh: m, dead: false, shake: 0, ry: m.rotation.y };
    ch.nodes.push(node); ch.col.push({ x, z, r: r * 1.05, node });
  }
  for (let a = 0; a < 8; a++) {
    const x = rx(), z = rz(); if (!wOK(W.cactus, x, z)) continue; const r = 0.38 + R() * 0.22; if (blocked(x, z, r + 2)) continue;
    const m = new THREE.Mesh(G.cactus, MAT.vc), by = baseH(x, z, r); m.position.set(x, by - 0.1, z); m.scale.setScalar(r); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    const node = { kind: 'tree', cactus: true, item: 'fiber', x, z, y0: by, r: r * 1.1, h: 5 * r, hp: 5 + r * 5, max: 5 + r * 5, yield: 2 + ((R() * 3) | 0), mesh: m, dead: false, shake: 0, ry: m.rotation.y };
    ch.nodes.push(node); ch.col.push({ x, z, r: r * 1.15, node });
  }
  /* stone and iron outcrops */
  for (let a = 0; a < 3; a++) {
    const x = rx(), z = rz(), s = 0.9 + R() * 0.7; if (!wOK(W.rock, x, z) || home(x, z, 8) || blocked(x, z, s + 1.2)) continue;
    const by = baseH(x, z, s * 0.9), m = new THREE.Mesh(G.rockNode[(R() * 2) | 0], bioAt(x, z) === BIOME.DUNES ? MAT.vcTan : MAT.vc); m.position.set(x, by + s * 0.1, z); m.scale.set(s, s * 0.85, s); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    const node = { kind: 'rock', x, z, y0: by, r: s * 0.95, h: s * 1.4, hp: 13, max: 13, yield: 3 + ((R() * 3) | 0), mesh: m, dead: false, shake: 0, ry: m.rotation.y, sc: s };
    ch.nodes.push(node); ch.col.push({ x, z, r: s * 0.9, node });
  }
  { const x = rx(), z = rz(), s = 0.9 + R() * 0.4;
    if (R() < W.ore[bioAt(x, z)] && !home(x, z, 10) && !blocked(x, z, s + 1.2)) {
      const by = baseH(x, z, s * 0.9), m = new THREE.Mesh(G.oreNode, MAT.ore); m.position.set(x, by + s * 0.1, z); m.scale.set(s, s * 0.9, s); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
      const node = { kind: 'ore', x, z, y0: by, r: s * 0.95, h: s * 1.4, hp: 18, max: 18, yield: 1 + ((R() * 3) | 0), mesh: m, dead: false, shake: 0, ry: m.rotation.y, sc: s };
      ch.nodes.push(node); ch.col.push({ x, z, r: s * 0.9, node });
    }
  }
  for (let a = 0; a < 3; a++) {
    const x = rx(), z = rz(), s = 0.9 + R() * 0.5; if (!wOK(W.bush, x, z) || home(x, z, 5) || blocked(x, z, s + 0.6)) continue;
    const m = new THREE.Mesh(G.bushBerry, MAT.vc); m.position.set(x, baseH(x, z, s * 0.9) - 0.05, z); m.scale.setScalar(s); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    ch.nodes.push({ kind: 'bush', x, z, y0: baseH(x, z, s * 0.9), r: s * 1.0, h: s * 1.3, hp: 1, max: 1, mesh: m, dead: false, shake: 0, ready: true, regrow: 0, sc: s, id: cx + ',' + cz + ',bush' + a });
  }

  /* scenery */
  { const lists = [[], []];
    for (let i = 0; i < 16; i++) {
      const x = rx(), z = rz(); if (!wOK(W.decoRock, x, z) || home(x, z, 5) || blocked(x, z, 1.2)) continue;
      const s = 0.25 + Math.pow(R(), 2.4) * 1.3, w = tint(0.85, 1.1), dn = bioAt(x, z) === BIOME.DUNES;
      lists[R() < 0.5 ? 0 : 1].push({ m: align(x, z, R() * TAU, -0.15 * s, s * (0.9 + R() * 0.5), s * (0.55 + R() * 0.4), s * (0.9 + R() * 0.5)), r: w[0] * (dn ? 1.3 : 1), g: w[1] * (dn ? 1.15 : 1), b: w[2] * (dn ? 0.85 : 1) });
    }
    flush(lists[0], G.rocks[0], MAT.vc, true); flush(lists[1], G.rocks[1], MAT.vc, true); }
  { const red = [], brown = [];
    for (let c = 0; c < 4; c++) {
      const mx = rx(), mz = rz(); if (!wOK(W.mush, mx, mz) || home(mx, mz, 7) || blocked(mx, mz, 2)) continue;
      const type = R() < 0.5 ? 'red' : 'brown';
      for (let k = 0, nk = 1 + ((R() * 5) | 0); k < nk; k++) {
        const a = R() * TAU, d = k === 0 ? 0 : 1 + R() * 2.5, x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d; if (blocked(x, z, 0.5)) continue;
        const s = 0.35 + Math.pow(R(), 1.6) * 1.4, w = tint(0.88, 1.08);
        (type === 'red' ? red : brown).push({ m: align(x, z, R() * TAU, -0.05 * s, s, s * (0.9 + R() * 0.3), s), r: w[0], g: w[1], b: w[2] });
      }
    }
    flush(red, G.mushRed, MAT.vc, true); flush(brown, G.mushBrown, MAT.vc, true); }
  { const list = [];
    for (let i = 0; i < 11; i++) { const x = rx(), z = rz(); if (!wOK(W.fern, x, z) || home(x, z, 5) || blocked(x, z, 1)) continue; const s = 1.5 + R() * 1.7, w = tint(0.75, 1.05); list.push({ m: align(x, z, R() * TAU, 0, s, s, s), r: w[0], g: w[1], b: w[2] }); }
    flush(list, G.fern, MAT.fern, false); }
  { const list = [], pal = [[0.9, 0.55, 0.2], [0.8, 0.35, 0.12], [0.75, 0.6, 0.2], [0.55, 0.32, 0.15], [0.5, 0.55, 0.2], [0.85, 0.7, 0.3]];
    for (let i = 0; i < 42; i++) { const x = rx(), z = rz(); if (!wOK(W.leaf, x, z) || blocked(x, z, 0.4)) continue; const s = 0.8 + R() * 1.6, p = pal[(R() * pal.length) | 0], j = 0.85 + R() * 0.3; list.push({ m: align(x, z, R() * TAU, 0.05, s, s, s), r: p[0] * j, g: p[1] * j, b: p[2] * j }); }
    flush(list, G.leaf, MAT.vc2, false); }
  { const list = [];
    for (let i = 0; i < 12; i++) { const x = rx(), z = rz(); if (!wOK(W.twig, x, z) || blocked(x, z, 0.4)) continue; const r = 0.08 + R() * 0.08, len = 2 + R() * 4, w = tint(0.8, 1.1); list.push({ m: align(x, z, R() * TAU, r * 0.35, r, r, len), r: w[0], g: w[1], b: w[2] }); }
    flush(list, G.twig, MAT.vc, false); }
  for (const [geo, seed] of [[G.flowerBell, 0], [G.flowerStar, 1]]) {
    const list = [];
    for (let i = 0; i < 24; i++) {
      const x = rx(), z = rz(); if (!wOK(W.flower, x, z) || blocked(x, z, 0.5)) continue; if (bioAt(x, z) !== BIOME.MEADOW && fbm(x * 0.05, z * 0.05, 2, 60 + seed) < 0.5) continue;
      const s = 0.9 + R() * 1.2, w = tint(0.92, 1.05); list.push({ m: mat4(x, H(x, z) - 0.05, z, (R() - 0.5) * 0.3, R() * TAU, (R() - 0.5) * 0.3, s * 0.8, s, s * 0.8), r: w[0], g: w[1], b: w[2] });
    }
    flush(list, geo, MAT.vc2, false);
  }
  { const list = [];
    for (let i = 0; i < 2600; i++) {
      const x = rx(), z = rz(), b = bioAt(x, z), dens = smooth(0.3, 0.62, fbm(x * 0.035, z * 0.035, 2, 51)), pr = (b === BIOME.MEADOW ? 0.6 + dens * 0.4 : dens * 0.9 + 0.1) * W.grass[b];
      if (R() > pr || home(x, z, 2.5) || blocked(x, z, 0.2)) continue;
      const h = 0.6 + Math.pow(R(), 1.6) * 1.7, w = 0.8 + R() * 0.7, dry = R() < 0.2, v = 0.85 + R() * 0.3, gt = GT[b];
      list.push({ m: mat4(x, H(x, z) - 0.05, z, (R() - 0.5) * 0.3, R() * TAU, (R() - 0.5) * 0.3, w, h, w), r: (dry ? 1.25 : 1) * v * gt[0], g: (dry ? 1.02 : 1) * v * gt[1], b: (dry ? 0.5 : 1) * v * gt[2] });
    }
    flush(list, G.grass, MAT.grass, false); }

  /* things to pick up by walking over them */
  const kinds = [
    { t: 'pebble', geo: G.pebble, item: 'stone', cnt: 8, mat: MAT.vc, w: W.pebble },
    { t: 'stick', geo: G.stick, item: 'stick', cnt: 7, mat: MAT.vc, w: W.stick },
    { t: 'fiber', geo: G.fiber, item: 'fiber', cnt: 10, mat: MAT.grass, scl: 0.8, w: W.fiber },
    { t: 'mush', geo: G.mushTan, item: 'mushroom', cnt: 4, mat: MAT.vc, scl: 0.32, w: W.mushPick }
  ];
  for (const kd of kinds) {
    const list = [], meta = [];
    for (let i = 0; i < kd.cnt; i++) {
      const x = rx(), z = rz(), id = cx + ',' + cz + ',' + kd.t + i; if (!wOK(kd.w, x, z) || home(x, z, 2) || blocked(x, z, 0.5)) continue;
      const s = kd.scl ? kd.scl * (0.8 + R() * 0.5) : 1, rot = R() * TAU; if (collected.has(id)) continue;
      list.push({ m: mat4(x, H(x, z), z, 0, rot, 0, s, kd.t === 'fiber' ? s * 1.1 : s, s), r: 1, g: 1, b: 1 }); meta.push({ x, z, item: kd.item, id, dead: false });
    }
    const m = flush(list, kd.geo, kd.mat, false);
    if (m) meta.forEach((mt, i) => { mt.mesh = m; mt.idx = i; ch.picks.push(mt); });
  }
  /* re-apply what the player changed: felled trees and broken rocks, dug or built columns */
  if (deadNodes.size) for (const n of ch.nodes) if (deadNodes.has(nk(n))) {
    n.dead = true; n.mesh.visible = false; ch.col = ch.col.filter(c => c.node !== n);
    if (n.kind === 'tree' && !n.cactus) { const st = new THREE.Mesh(G.stump, MAT.vc); st.position.set(n.x, n.y0 - 0.1, n.z); st.scale.set(n.r, n.r * 0.8, n.r); st.castShadow = true; st.receiveShadow = true; grp.add(st); ch.col.push({ x: n.x, z: n.z, r: Math.max(0.5, n.r * 0.9), node: null }); }
  }
  for (const e of edits.values()) if (e.i >= x0 && e.i < x0 + S && e.k >= z0 && e.k < z0 + S && e.j >= WG.terr(e.i, e.k).h - 1) removeSceneryIn(ch, e.i, e.k);
  scene.add(grp); return ch;
}
function disposeChunk(ch) { scene.remove(ch.grp); for (const d of ch.disp) d.dispose(); for (const k in ch.gm) if (ch.gm[k]) ch.gm[k].geometry.dispose(); }
function ensureChunks(force) {
  const pcx = Math.round(P.x / S), pcz = Math.round(P.z / S), need = [];
  for (let dx = -RAD; dx <= RAD; dx++) for (let dz = -RAD; dz <= RAD; dz++) { const k = (pcx + dx) + ',' + (pcz + dz); if (!chunks.has(k)) need.push({ k, cx: pcx + dx, cz: pcz + dz, d: dx * dx + dz * dz }); }
  need.sort((a, b) => a.d - b.d);
  if (force) { for (let i = 0; i < need.length; i++) chunks.set(need[i].k, genChunk(need[i].cx, need[i].cz)); }
  else if (need.length) {
    const c = need[0]; let miss = null;
    for (let dx = -1; dx <= 1 && !miss; dx++) for (let dz = -1; dz <= 1 && !miss; dz++) if (!chunkData.has((c.cx + dx) + ',' + (c.cz + dz))) miss = [c.cx + dx, c.cz + dz];
    if (miss) cdata(miss[0], miss[1]); else chunks.set(c.k, genChunk(c.cx, c.cz));
  } else {
    for (let r = 0; r <= RAD + 1; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r && !chunkData.has((pcx + dx) + ',' + (pcz + dz))) { cdata(pcx + dx, pcz + dz); r = 99; dx = 99; break; }
  }
  for (const [k, ch] of chunks) if (Math.abs(ch.cx - pcx) > RAD + 1 || Math.abs(ch.cz - pcz) > RAD + 1) { disposeChunk(ch); chunks.delete(k); }
}
function nearChunks(fn) { const pcx = Math.round(P.x / S), pcz = Math.round(P.z / S); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const ch = chunks.get((pcx + dx) + ',' + (pcz + dz)); if (ch) fn(ch); } }

/* ================= sky, sunbeams, motes, fireflies ================= */
const skyMat = new THREE.ShaderMaterial({
  uniforms: { cHor: { value: new THREE.Color() }, cTop: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() } },
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 cHor, cTop, sunCol, sunDir; varying vec3 vD; void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(cHor, cTop, pow(h, 0.55)); float s = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(s, 48.0) * 0.8 + pow(s, 6.0) * 0.22); gl_FragColor = vec4(c, 1.0); }'
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 12), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

const SH_C = 26;
const shaftGeo = (() => {
  const a = new THREE.PlaneGeometry(5, 70), b = new THREE.PlaneGeometry(5, 70); b.rotateY(Math.PI / 2);
  const pos = [], uv = [], idx = []; let base = 0;
  for (const g of [a, b]) { for (let i = 0; i < g.attributes.position.count; i++) { pos.push(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)); uv.push(g.attributes.uv.getX(i), g.attributes.uv.getY(i)); } for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base); base += g.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
})();
const shafts = [];
for (let i = 0; i < 25; i++) { const m = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0 })); m.frustumCulled = false; m.visible = false; scene.add(m); shafts.push(m); }
const shaftQ = new THREE.Quaternion();
function updateShafts(t) {
  shaftQ.setFromUnitVectors(UP, TOD.dir);
  const pi = Math.floor(P.x / SH_C), pj = Math.floor(P.z / SH_C);
  for (let i = pi - 2; i <= pi + 2; i++) for (let j = pj - 2; j <= pj + 2; j++) {
    const m = shafts[(((i % 5) + 5) % 5) * 5 + (((j % 5) + 5) % 5)], h = hash2(i, j, 300);
    if (h < 0.5) { m.visible = false; continue; }
    const x = (i + hash2(i, j, 301)) * SH_C, z = (j + hash2(i, j, 302)) * SH_C, y = H(x, z);
    m.visible = true; m.quaternion.copy(shaftQ); m.position.set(x + TOD.dir.x * 33, y + TOD.dir.y * 33, z + TOD.dir.z * 33); m.scale.set(0.6 + hash2(i, j, 303) * 1.2, 1, 1);
    const d = Math.hypot(x - P.x, z - P.z), fade = 1 - smooth(22, 56, d);
    m.material.opacity = 0.32 * TOD.shaft * fade * (0.7 + 0.3 * Math.sin(t * 0.6 + h * 40)); m.material.color.copy(TOD.sun);
  }
}
const MN = 300, moteGeo = new THREE.BufferGeometry(), moteP = new Float32Array(MN * 3), moteR = new Float32Array(MN), moteV = new Float32Array(MN * 3);
for (let i = 0; i < MN; i++) { moteP[i * 3] = (Math.random() - 0.5) * 60; moteP[i * 3 + 2] = (Math.random() - 0.5) * 60; moteR[i] = 0.3 + Math.random() * 13; moteV[i * 3] = (Math.random() - 0.5) * 0.4; moteV[i * 3 + 1] = (Math.random() - 0.5) * 0.15; moteV[i * 3 + 2] = (Math.random() - 0.5) * 0.4; }
moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MN * 3), 3));
const moteMat = new THREE.PointsMaterial({ size: 0.26, map: moteTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6, color: 0xfff0c0, fog: false });
const motes = new THREE.Points(moteGeo, moteMat); motes.frustumCulled = false; scene.add(motes);
function updateMotes(dt, t) {
  const pa = moteGeo.attributes.position.array;
  for (let i = 0; i < MN; i++) {
    moteP[i * 3] += (moteV[i * 3] + Math.sin(t * 0.5 + i) * 0.15) * dt; moteP[i * 3 + 2] += (moteV[i * 3 + 2] + Math.cos(t * 0.4 + i * 1.3) * 0.15) * dt;
    moteR[i] += (moteV[i * 3 + 1] - 2.4 * snowU) * dt; if (moteR[i] < 0.3) moteR[i] = 13; if (moteR[i] > 13.5) moteR[i] = 0.4;
    const dx = moteP[i * 3] - P.x; if (dx > 30) moteP[i * 3] -= 60; else if (dx < -30) moteP[i * 3] += 60;
    const dz = moteP[i * 3 + 2] - P.z; if (dz > 30) moteP[i * 3 + 2] -= 60; else if (dz < -30) moteP[i * 3 + 2] += 60;
    pa[i * 3] = moteP[i * 3]; pa[i * 3 + 1] = P.y + moteR[i]; pa[i * 3 + 2] = moteP[i * 3 + 2];
  }
  moteGeo.attributes.position.needsUpdate = true; moteMat.opacity = (0.6 * (1 - TOD.night * 0.85 * (1 - snowU)) + 0.2 * snowU) * (1 - ugU); moteMat.color.copy(TOD.sun).lerp(WHITE, snowU); moteMat.size = 0.26 + 0.24 * snowU;
}
const FN = 46, ffGeo = new THREE.BufferGeometry(), ffP = new Float32Array(FN * 3), ffC = new Float32Array(FN * 3), ffB = [];
for (let i = 0; i < FN; i++) ffB.push({ x: (Math.random() - 0.5) * 70, z: (Math.random() - 0.5) * 70, y: 0.6 + Math.random() * 4, s: Math.random() * 6 });
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffP, 3)); ffGeo.setAttribute('color', new THREE.BufferAttribute(ffC, 3));
const flies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ size: 0.8, map: moteTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); flies.frustumCulled = false; scene.add(flies);
function updateFlies(dt, t) {
  for (let i = 0; i < FN; i++) {
    const f = ffB[i]; f.x += Math.sin(t * 0.3 + f.s) * 0.9 * dt; f.z += Math.cos(t * 0.27 + f.s * 2) * 0.9 * dt;
    const dx = f.x - P.x; if (dx > 35) f.x -= 70; else if (dx < -35) f.x += 70; const dz = f.z - P.z; if (dz > 35) f.z -= 70; else if (dz < -35) f.z += 70;
    ffP[i * 3] = f.x; ffP[i * 3 + 1] = H(f.x, f.z) + f.y + Math.sin(t * 0.8 + f.s) * 0.6; ffP[i * 3 + 2] = f.z;
    const b = Math.pow(Math.max(0, Math.sin(t * 1.7 + f.s * 3.1)), 3) * TOD.ff * (1 - ugU); ffC[i * 3] = 0.85 * b; ffC[i * 3 + 1] = b; ffC[i * 3 + 2] = 0.3 * b;
  }
  ffGeo.attributes.position.needsUpdate = true; ffGeo.attributes.color.needsUpdate = true;
}

/* chips and sparks */
const PN = 90, partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial(), PN), parts = [];
partMesh.frustumCulled = false; scene.add(partMesh);
for (let i = 0; i < PN; i++) { parts.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }); partMesh.setMatrixAt(i, ZERO); tmpC.setRGB(1, 1, 1); partMesh.setColorAt(i, tmpC); }
let partNext = 0;
function burst(x, y, z, col, n) {
  tmpC.set(col);
  for (let k = 0; k < n; k++) {
    const i = partNext++ % PN, p = parts[i]; p.life = 0.5 + Math.random() * 0.4; p.x = x; p.y = y; p.z = z; p.vx = (Math.random() - 0.5) * 5; p.vy = 2 + Math.random() * 4; p.vz = (Math.random() - 0.5) * 5; p.s = 0.6 + Math.random() * 0.9;
    const v = 0.8 + Math.random() * 0.3; partMesh.setColorAt(i, tmpC.clone().multiplyScalar(v));
  }
  partMesh.instanceColor.needsUpdate = true;
}
function updateParts(dt) {
  for (let i = 0; i < PN; i++) {
    const p = parts[i]; if (p.life <= 0) continue; p.life -= dt; p.vy -= 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const g = surf(p.x, p.z); if (p.y < g) { p.y = g; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
    if (p.life <= 0) partMesh.setMatrixAt(i, ZERO); else { dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.life * 8, p.life * 5, 0); dummy.scale.setScalar(p.s * Math.min(1, p.life * 3)); dummy.updateMatrix(); partMesh.setMatrixAt(i, dummy.matrix); }
  }
  partMesh.instanceMatrix.needsUpdate = true;
}

/* ================= time of day ================= */
const C = s => new THREE.Color(s);
const TK = [
  { p: 0.00, fog: C('#c9a98b'), sky: C('#ffd9b8'), gnd: C('#4a3a2a'), sun: C('#ffb98a'), sunI: 0.9, hemiI: 0.6, shaft: 0.55, ff: 0.25, el: 0.42, tint: [1.06, 0.98, 0.94] },
  { p: 0.25, fog: C('#b3c78c'), sky: C('#dff0b4'), gnd: C('#403a22'), sun: C('#fff0c0'), sunI: 1.2, hemiI: 0.8, shaft: 1.0, ff: 0.0, el: 0.95, tint: [1.02, 1.0, 0.96] },
  { p: 0.50, fog: C('#cf8d5c'), sky: C('#ffb684'), gnd: C('#3a2a26'), sun: C('#ff8c4c'), sunI: 0.95, hemiI: 0.6, shaft: 0.65, ff: 0.85, el: 0.4, tint: [1.1, 0.96, 0.9] },
  { p: 0.75, fog: C('#1a2d40'), sky: C('#4a6e9c'), gnd: C('#10171f'), sun: C('#8fb0e6'), sunI: 0.6, hemiI: 0.62, shaft: 0.2, ff: 1.0, el: 0.75, tint: [0.92, 1.0, 1.1] },
  { p: 1.00, fog: C('#c9a98b'), sky: C('#ffd9b8'), gnd: C('#4a3a2a'), sun: C('#ffb98a'), sunI: 0.9, hemiI: 0.6, shaft: 0.55, ff: 0.25, el: 0.42, tint: [1.06, 0.98, 0.94] }
];
const TOD = { fog: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(), sun: new THREE.Color(), sunI: 1, hemiI: 1, shaft: 1, ff: 0, el: 0.9, night: 0, p: 0, dir: new THREE.Vector3() };
let todT = 0.12 * DAY_LEN;
const UWC = new THREE.Color('#1f6a86'), WHITE = new THREE.Color(1, 1, 1), FOGT = [0.015, 0.014, 0.013, 0.016, 0.022, 0.010];
function updateTOD() {
  const p = ((todT / DAY_LEN) % 1 + 1) % 1; TOD.p = p;
  let i = 0; while (i < TK.length - 2 && p >= TK[i + 1].p) i++;
  const a = TK[i], b = TK[i + 1], t = smooth(0, 1, (p - a.p) / (b.p - a.p));
  TOD.fog.copy(a.fog).lerp(b.fog, t); TOD.sky.copy(a.sky).lerp(b.sky, t); TOD.gnd.copy(a.gnd).lerp(b.gnd, t); TOD.sun.copy(a.sun).lerp(b.sun, t);
  TOD.sunI = lerp(a.sunI, b.sunI, t); TOD.hemiI = lerp(a.hemiI, b.hemiI, t); TOD.shaft = lerp(a.shaft, b.shaft, t); TOD.ff = lerp(a.ff, b.ff, t); TOD.el = lerp(a.el, b.el, t);
  TOD.night = smooth(0.55, 0.7, p) * (1 - smooth(0.88, 0.98, p));
  const az = p * TAU * 0.8 + 0.6; TOD.dir.set(Math.cos(TOD.el) * Math.cos(az), Math.sin(TOD.el), Math.cos(TOD.el) * Math.sin(az)).normalize();
  scene.background.copy(TOD.fog).multiplyScalar(1 - 0.92 * ugU); scene.fog.color.copy(scene.background);
  if (uwU > 0.01) { scene.background.lerp(tmpC.copy(UWC).multiplyScalar(0.4 + 0.6 * (1 - TOD.night)), uwU); scene.fog.color.copy(scene.background); }
  scene.fog.density = fogD + 0.06 * uwU;
  hemi.color.copy(TOD.sky); hemi.groundColor.copy(TOD.gnd); hemi.intensity = TOD.hemiI * (1 - 0.8 * ugU); sun.color.copy(TOD.sun); sun.intensity = TOD.sunI;
  skyMat.uniforms.cHor.value.copy(TOD.fog); skyMat.uniforms.cTop.value.copy(TOD.sky).multiplyScalar(0.7).lerp(TOD.fog, 0.35);
  skyMat.uniforms.sunDir.value.copy(TOD.dir); skyMat.uniforms.sunCol.value.copy(TOD.sun).multiplyScalar(0.7 - TOD.night * 0.3);
  if (grade) grade.uniforms.uTint.value.set(lerp(a.tint[0], b.tint[0], t), lerp(a.tint[1], b.tint[1], t), lerp(a.tint[2], b.tint[2], t));
  lantern.intensity = 0.35 + TOD.night * 1.5 + 1.2 * ugU; lantern.distance = 16 + 8 * ugU;
}

/* ================= audio ================= */
let AC = null, master = null, muted = false;
function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(AC.destination);
    const len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const gn = AC.createGain(); gn.gain.value = 0.22; src.connect(lp); lp.connect(gn); gn.connect(master); src.start();
  } catch (e) { AC = null; }
}
function tone(f0, f1, dur, type, vol, delay) {
  if (!AC) return; const t = AC.currentTime + (delay || 0), o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(dur, f, vol, q) {
  if (!AC) return; const n = (AC.sampleRate * dur) | 0, b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = AC.createBufferSource(); s.buffer = b; const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q || 0.8;
  const g = AC.createGain(); g.gain.value = vol; s.connect(bp); bp.connect(g); g.connect(master); s.start();
}
const sfx = {
  step() { noiseBurst(0.05, 2400 + Math.random() * 1500, 0.12); }, jump() { tone(300, 520, 0.12, 'sine', 0.1); },
  chop() { noiseBurst(0.12, 380, 0.5, 1.2); tone(140, 80, 0.1, 'triangle', 0.25); }, mine() { tone(1500, 900, 0.09, 'square', 0.07); noiseBurst(0.08, 3000, 0.25, 2); },
  swing() { noiseBurst(0.12, 1400, 0.1, 0.5); }, dig() { noiseBurst(0.1, 260, 0.55, 0.9); tone(110, 70, 0.08, 'triangle', 0.15); }, place() { tone(220, 160, 0.09, 'triangle', 0.25); noiseBurst(0.07, 600, 0.3); },
  pickup() { tone(700, 1000, 0.1, 'sine', 0.16); tone(1050, 1500, 0.12, 'sine', 0.13, 0.06); }, craft() { [520, 700, 880].forEach((f, i) => tone(f, f, 0.14, 'triangle', 0.16, i * 0.07)); },
  eat() { noiseBurst(0.09, 900, 0.3); noiseBurst(0.09, 700, 0.3); }, hurt() { tone(220, 70, 0.35, 'square', 0.2); noiseBurst(0.22, 500, 0.3); },
  clang() { tone(900, 600, 0.18, 'square', 0.1); tone(1350, 900, 0.2, 'sine', 0.12); }, bite() { noiseBurst(0.1, 1800, 0.4, 2); },
  squish() { tone(180, 60, 0.18, 'sawtooth', 0.12); noiseBurst(0.12, 500, 0.3); }, brk() { noiseBurst(0.25, 450, 0.6, 0.6); tone(120, 60, 0.2, 'triangle', 0.3); },
  chirp() { for (let i = 0; i < 4; i++) tone(4300, 4300, 0.035, 'sine', 0.02, i * 0.07); },
  growl() { tone(90, 60, 0.4, 'sawtooth', 0.09); }, hoot() { tone(390, 350, 0.4, 'sine', 0.14); tone(390, 340, 0.5, 'sine', 0.14, 0.55); }
};

/* ================= player, gnome, held models ================= */
const P = { x: 0, z: 3, y: 0, vx: 0, vz: 0, vy: 0, heading: Math.PI, grounded: true, stamina: 100, exhausted: false, hp: 100, hunger: 80, speed: 0,
  cool: 0, swing: 0, swingHit: true, blocking: false, phase: 0, stepD: 0, invuln: 0, kx: 0, kz: 0, spawnX: 0, spawnZ: 3, regenT: 0 };
let state = 'menu', ready = false, camYaw = 0, camPitch = 0.28, camDist = 6.2, camDistNow = 6.2, ugU = 0, uwU = 0, snowU = 0, fogD = 0.015, mining = null, shake = 0, dmgFlash = 0, locked = false, mouseHeld = false, mouseX = innerWidth / 2, mouseY = innerHeight / 2;
const camTarget = new THREE.Vector3(0, 1.3, 3), keys = {};

const gnome = (function () {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const std = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.85 : r, metalness: m || 0 });
  const M = { skin: std(0xefc49b, 0.7), nose: std(0xe59a8a, 0.6), beard: std(0xf3f1ea, 0.95), hat: std(0xc8322e, 0.8), tunic: std(0x2f6b3a, 0.9), pants: std(0x4a5468, 0.9), boot: std(0x4a2f1a, 0.8), belt: std(0x5a3a1c, 0.7), pack: std(0x8a5a2f, 0.9), gold: std(0xd9b04a, 0.3, 0.7), dark: std(0x101010, 0.3) };
  const sph = SphereGeo => null;
  const S1 = new THREE.SphereGeometry(1, 18, 14);
  const ball = (m, sx, sy, sz, x, y, z, p) => { const o = new THREE.Mesh(S1, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); (p || g).add(o); return o; };
  const cyl = (m, rt, rb, h, x, y, z, p, seg) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), m); o.position.set(x, y, z); (p || g).add(o); return o; };
  const body = new THREE.Group(); g.add(body);
  /* legs */
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.13, 0.55, 0); g.add(hip);
    cyl(M.pants, 0.09, 0.08, 0.36, 0, -0.18, 0, hip); ball(M.boot, 0.12, 0.09, 0.19, 0, -0.42, 0.05, hip); legs.push(hip);
  }
  /* torso, belt, buckle */
  cyl(M.tunic, 0.24, 0.29, 0.5, 0, 0.78, 0, body); cyl(M.belt, 0.295, 0.295, 0.07, 0, 0.62, 0, body, 16); const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.03), M.gold); buckle.position.set(0, 0.62, 0.29); body.add(buckle);
  /* head, nose, eyes */
  ball(M.skin, 0.23, 0.22, 0.22, 0, 1.13, 0.02, body); ball(M.nose, 0.085, 0.085, 0.09, 0, 1.1, 0.25, body);
  for (const s of [-1, 1]) { ball(M.dark, 0.028, 0.034, 0.02, s * 0.085, 1.18, 0.2, body); const br = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), M.beard); br.position.set(s * 0.085, 1.235, 0.2); br.rotation.z = s * -0.25; body.add(br); }
  /* beard and moustache */
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.62, 14), M.beard); beard.rotation.x = Math.PI; beard.position.set(0, 0.84, 0.13); beard.scale.z = 0.7; body.add(beard);
  ball(M.beard, 0.15, 0.05, 0.07, 0, 1.03, 0.22, body);
  /* hat: two bent cones */
  const hat1 = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.5, 14), M.hat); hat1.position.set(0, 1.5, -0.02); body.add(hat1);
  const hat2 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 12), M.hat); hat2.position.set(0, 1.86, -0.12); hat2.rotation.x = -0.35; body.add(hat2);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 8, 20), M.hat); brim.rotation.x = Math.PI / 2; brim.position.set(0, 1.27, 0); body.add(brim);
  /* backpack with bedroll */
  const pk = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.2), M.pack); pk.position.set(0, 0.8, -0.3); body.add(pk); cyl(M.hat, 0.09, 0.09, 0.44, 0, 1.06, -0.3, body).rotation.z = Math.PI / 2;
  /* lantern on belt */
  const lanternG = new THREE.Group(); lanternG.position.set(0.3, 0.56, 0.06); body.add(lanternG);
  cyl(M.gold, 0.06, 0.06, 0.16, 0, 0, 0, lanternG, 8); const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc36a })); lanternG.add(core);
  const lsp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowWarm, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 })); lsp.scale.setScalar(0.7); lanternG.add(lsp);
  /* arms: right holds tools, left holds the shield */
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.32, 0.98, 0); body.add(shoulder);
    cyl(M.tunic, 0.075, 0.065, 0.42, 0, -0.21, 0, shoulder); const hand = new THREE.Group(); hand.position.set(0, -0.46, 0); shoulder.add(hand); ball(M.skin, 0.07, 0.07, 0.07, 0, 0, 0, hand); arms.push({ sh: shoulder, hand });
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
  return { g, body, legs, armR: arms[0], armL: arms[1], lanternCore: core, lsp };
})();
/* right arm is at -X because the gnome faces +Z */
const held = new THREE.Group(); gnome.armR.hand.add(held);
const shieldHold = new THREE.Group(); gnome.armL.hand.add(shieldHold);

function makeHeld(id) {
  const g = new THREE.Group(), d = ITEMS[id]; if (!d) return g;
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
  const tier = d.tier || 1, tc = { 1: 0xb58a55, 2: 0x8e9094, 3: 0xcfd6de, 4: 0x33254d }[tier];
  const headM = new THREE.MeshStandardMaterial({ color: tc, roughness: tier === 3 ? 0.25 : 0.7, metalness: tier === 3 ? 0.85 : 0.1 });
  const add = (geo, m, x, y, z, rx, ry, rz) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); o.castShadow = true; g.add(o); return o; };
  if (d.tool === 'axe') { add(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), wood, 0, 0.32, 0); add(new THREE.BoxGeometry(0.3, 0.24, 0.05), headM, 0.14, 0.7, 0); add(new THREE.BoxGeometry(0.06, 0.34, 0.06), headM, 0.3, 0.7, 0); }
  else if (d.tool === 'pick') { add(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), wood, 0, 0.32, 0); add(new THREE.BoxGeometry(0.72, 0.07, 0.07), headM, 0, 0.75, 0); add(new THREE.ConeGeometry(0.05, 0.16, 6), headM, 0.42, 0.75, 0, 0, 0, -Math.PI / 2); add(new THREE.ConeGeometry(0.05, 0.16, 6), headM, -0.42, 0.75, 0, 0, 0, Math.PI / 2); }
  else if (d.tool === 'shovel') { add(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), wood, 0, 0.32, 0); add(new THREE.BoxGeometry(0.06, 0.06, 0.2), wood, 0, 0.78, 0); add(new THREE.BoxGeometry(0.24, 0.36, 0.035), headM, 0, 0.0 - 0.02, 0.0).position.set(0, 0.86 - 0.02, 0); }
  else if (d.tool === 'sword') { add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), wood, 0, 0.1, 0); add(new THREE.BoxGeometry(0.3, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.6, roughness: 0.4 }), 0, 0.22, 0); add(new THREE.BoxGeometry(0.09, 0.78, 0.02), headM, 0, 0.64, 0); add(new THREE.ConeGeometry(0.045, 0.14, 4), headM, 0, 1.08, 0); }
  else if (d.k === 'shield') {
    const face = id === 'cshield' ? 0x33254d : id === 'wshield' ? 0xb98450 : tc, m = new THREE.MeshStandardMaterial({ color: face, roughness: tier === 3 ? 0.3 : 0.7, metalness: tier === 3 ? 0.8 : 0.1 });
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.07, 20), m, 0, 0, 0, Math.PI / 2, 0, 0); add(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshStandardMaterial({ color: id === 'cshield' ? 0x8f6bd6 : 0xd8b04a, metalness: 0.7, roughness: 0.3 }), 0, 0, 0.05);
    add(new THREE.TorusGeometry(0.4, 0.03, 6, 20), new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.7, roughness: 0.4 }), 0, 0, 0);
  } else if (d.k === 'block') { add(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: BCOL[d.bid] || 0xaaaaaa, roughness: 0.9, emissive: d.bid === B.CRYSTAL ? 0x2288aa : 0x000000 }), 0, 0.16, 0.05); }
  else if (d.k === 'station') { const c = { bench: 0xb98450, furnace: 0x86888d, camp: 0xd9812a, bed: 0xb7362d, torch: 0xffb030, ladder: 0x9a6a3a }[d.place] || 0xaaaaaa; add(new THREE.BoxGeometry(0.32, 0.32, 0.32), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }), 0, 0.18, 0.05); }
  else if (d.k === 'food') { const c = { berries: 0xc0223a, mushroom: 0xc9a066, cmush: 0x8a4a1e, bandage: 0xf1ece0, meat: 0xd9707a, cmeat: 0x8a4a2a }[id]; add(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }), 0, 0.12, 0.04); }
  else { const c = { wood: 0x7b5330, stick: 0x7a5230, stone: 0x8d8f93, fiber: 0xb7c66a, ore: 0x6f6a66, ingot: 0xd5dbe2, shell: 0x33254d, coal: 0x2a2a2e }[id] || 0xaaaaaa; add(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: id === 'ingot' ? 0.8 : 0 }), 0, 0.12, 0.04); }
  return g;
}
let heldKey = '', shieldKey = '';
function updateHeld() {
  const s = inv[sel], id = s ? s.id : '', sh = bestShield(), sid = sh ? sh.id : '';
  if (id !== heldKey) {
    heldKey = id; while (held.children.length) held.remove(held.children[0]);
    if (id) { const m = makeHeld(id); m.rotation.x = 1.15; held.add(m); }
  }
  if (sid !== shieldKey) {
    shieldKey = sid; while (shieldHold.children.length) shieldHold.remove(shieldHold.children[0]);
    if (sid) { const m = makeHeld(sid); m.scale.setScalar(0.9); shieldHold.add(m); }
  }
}

/* ================= aiming ================= */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(0, 0), aim = { type: null, cell: null, ok: false, place: null, placeOK: false, pt: new THREE.Vector3(), node: null, block: null, enemy: null };
function rayCyl(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx, oz = o.z - cz, a = d.x * d.x + d.z * d.z; if (a < 1e-8) return null;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r, disc = b * b - 4 * a * c; if (disc < 0) return null;
  const sq = Math.sqrt(disc); let t = (-b - sq) / (2 * a); if (t < 0) t = (-b + sq) / (2 * a); if (t < 0) return null;
  const y = o.y + d.y * t; if (y < y0 - 0.1 || y > y1) return null; return t;
}
function computeAim() {
  if (locked || isTouch) ndc.set(0, 0); else ndc.set(mouseX / innerWidth * 2 - 1, -(mouseY / innerHeight * 2 - 1));
  camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction;
  aim.type = null; aim.node = null; aim.block = null; aim.enemy = null; aim.place = null; aim.cell = null; aim.ok = false; aim.placeOK = false;
  let bestT = 1e9;
  nearChunks(ch => { for (const n of ch.nodes) { if (n.dead) continue; const t = rayCyl(o, d, n.x, n.z, n.r + 0.15, n.y0, n.y0 + n.h); if (t !== null && t < bestT) { bestT = t; aim.type = 'node'; aim.node = n; } } });
  for (const e of enemies) { if (e.dying) continue; const t = rayCyl(o, d, e.x, e.z, 0.85, e.y, e.y + 1.0); if (t !== null && t < bestT) { bestT = t; aim.type = 'enemy'; aim.enemy = e; aim.node = null; } }
  let prev = null, li = 1e9, lj = 0, lk = 0; const tmax = Math.min(bestT, 20);
  for (let t = 0.4; t < tmax; t += 0.07) {
    const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t, i = Math.floor(px), j = Math.floor(py), k = Math.floor(pz);
    if (i === li && j === lj && k === lk) continue; li = i; lj = j; lk = k;
    if (blocks.size) { const b = blocks.get(key(i, j, k)); if (b) { bestT = t; aim.type = 'block'; aim.block = b; aim.node = null; aim.enemy = null; aim.place = prev; break; } }
    if (SOLIDB[getBlock(i, j, k)]) { bestT = t; aim.type = 'ground'; aim.cell = [i, j, k]; aim.node = null; aim.enemy = null; aim.place = prev; break; }
    prev = [i, j, k];
  }
  if (aim.type) {
    aim.pt.set(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
    aim.ok = Math.hypot(aim.pt.x - P.x, aim.pt.y - (P.y + 0.9), aim.pt.z - P.z) < REACH;
    if (aim.type === 'node' && aim.node) aim.ok = Math.hypot(aim.node.x - P.x, aim.node.z - P.z) < REACH + aim.node.r;
    if (aim.type === 'enemy') aim.ok = Math.hypot(aim.enemy.x - P.x, aim.enemy.z - P.z) < REACH;
    if (aim.place) {
      const [i, j, k] = aim.place;
      let ok = !solid(i, j, k) && !blocks.has(key(i, j, k)) && Math.hypot(i + 0.5 - P.x, k + 0.5 - P.z) < REACH + 1.2;
      const hs = inv[sel], hd = hs ? ITEMS[hs.id] : null, nsItem = !!hd && hd.k === 'station' && !!BDEF[hd.place] && !!BDEF[hd.place].ns;
      if (!nsItem && Math.abs(i + 0.5 - P.x) < PRAD + 0.5 && Math.abs(k + 0.5 - P.z) < PRAD + 0.5 && j < P.y + PHGT && j + 1 > P.y + 0.05) ok = false;
      if (!nsItem) for (const e of enemies) if (Math.abs(i + 0.5 - e.x) < 1.0 && Math.abs(k + 0.5 - e.z) < 1.0) ok = false;
      aim.placeOK = ok;
    }
  }
}
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.35, depthWrite: false }));
ghost.visible = false; ghost.renderOrder = 5; scene.add(ghost);
const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)), new THREE.LineBasicMaterial({ color: 0xffffff })); selBox.visible = false; scene.add(selBox);

/* ================= enemies: gloom beetles ================= */
const enemies = [];
function makeBeetle() {
  const g = new THREE.Group(), shell = new THREE.MeshStandardMaterial({ color: 0x2a1f3d, roughness: 0.3, metalness: 0.55 }), dk = new THREE.MeshStandardMaterial({ color: 0x140d1e, roughness: 0.5 });
  const S1 = new THREE.SphereGeometry(1, 16, 12);
  const body = new THREE.Mesh(S1, shell); body.scale.set(0.55, 0.4, 0.82); body.position.y = 0.45; g.add(body);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 1.3), new THREE.MeshStandardMaterial({ color: 0x6b4ba8, roughness: 0.3, metalness: 0.6 })); ridge.position.set(0, 0.84, -0.05); g.add(ridge);
  const head = new THREE.Mesh(S1, dk); head.scale.set(0.3, 0.24, 0.3); head.position.set(0, 0.42, 0.8); g.add(head);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xff4030 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), eyeM); e.position.set(s * 0.13, 0.5, 1.03); g.add(e); const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 6), dk); m.position.set(s * 0.14, 0.34, 1.05); m.rotation.set(Math.PI / 2, 0, s * 0.5); g.add(m); }
  const legs = [];
  for (const s of [-1, 1]) for (const z of [0.4, 0, -0.4]) { const p = new THREE.Group(); p.position.set(s * 0.42, 0.42, z); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.62, 5), dk); l.position.set(s * 0.3, -0.12, 0); l.rotation.z = -s * 1.1; p.add(l); g.add(p); legs.push({ p, ph: (z > 0 ? 0 : Math.PI) + (s > 0 ? 0 : Math.PI / 2) }); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const tex = new THREE.CanvasTexture(cv);
  const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); bar.scale.set(1.3, 0.16, 1); bar.position.y = 1.5; g.add(bar);
  return { g, legs, bar, cv, tex };
}
function drawBar(e) {
  const c = e.cv.getContext('2d'); c.clearRect(0, 0, 64, 8); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, 64, 8); c.fillStyle = '#d9483b'; c.fillRect(1, 1, 62 * clamp(e.hp / e.max, 0, 1), 6); e.tex.needsUpdate = true;
}
let spawnT = 6, caveT = 12;
function spawnBeetle() {
  let x = 0, z = 0, y = 0, cave = false;
  if (ugU > 0.5) {
    let ok = false;
    for (let t = 0; t < 24 && !ok; t++) {
      const a = Math.random() * TAU, d = 7 + Math.random() * 12; x = P.x + Math.cos(a) * d; z = P.z + Math.sin(a) * d; const i = Math.floor(x), k = Math.floor(z);
      for (let j = Math.floor(P.y) + 5; j > Math.floor(P.y) - 6; j--) if (!solid(i, j, k) && !solid(i, j + 1, k) && solid(i, j - 1, k) && getBlock(i, j, k) !== B.LAVA && getBlock(i, j, k) !== B.WATER) { y = j; ok = true; cave = true; break; }
    }
    if (!ok) return;
  } else {
    const a = Math.random() * TAU, d = 26 + Math.random() * 10; x = P.x + Math.cos(a) * d; z = P.z + Math.sin(a) * d;
    if (WG.terr(Math.floor(x), Math.floor(z)).h <= SEA + 1) return; y = surf(x, z);
  }
  const m = makeBeetle();
  const e = { x, z, y, cave, vx: 0, vz: 0, hp: 30, max: 30, cd: 1, heading: 0, phase: Math.random() * 6, dying: 0, burn: 0, kx: 0, kz: 0, ...m };
  e.g.position.set(x, e.y, z); e.g.scale.setScalar(1.15); scene.add(e.g); drawBar(e); enemies.push(e);
}
function removeEnemy(e) { scene.remove(e.g); e.tex.dispose(); const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1); }
function fireNear(x, z, r) { for (const b of stations) if ((b.t === 'camp' || b.t === 'torch') && Math.hypot(b.i + 0.5 - x, b.k + 0.5 - z) < (b.t === 'camp' ? r : r * 0.45)) return b; return null; }
function updateEnemies(dt, t) {
  const day = Math.floor(todT / DAY_LEN);
  spawnT -= dt; caveT -= dt;
  if (state === 'play' && ugU > 0.6 && caveT <= 0 && enemies.filter(q => q.cave).length < 3) { spawnBeetle(); caveT = 9 + Math.random() * 8; }
  if (state === 'play' && TOD.night > 0.35 && enemies.length < Math.min(9, 3 + day * 2) && spawnT <= 0) { spawnBeetle(); spawnT = 3.5 + Math.random() * 3; if (Math.random() < 0.3) sfx.growl(); }
  for (const e of enemies.slice()) {
    if (e.dying) { e.dying += dt; e.g.scale.setScalar(Math.max(0.01, 1.15 * (1 - e.dying * 1.6))); if (e.dying > 0.65) removeEnemy(e); continue; }
    if ((!e.cave && TOD.night < 0.12) || Math.hypot(e.x - P.x, e.z - P.z) > 70) { e.burn += dt; e.g.scale.setScalar(Math.max(0.01, 1.15 * (1 - e.burn * 0.5))); if (e.burn > 1.9) { removeEnemy(e); continue; } }
    const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz) || 1; let tx = 0, tz = 0, sp = 0;
    if (state === 'play' && d < 30) { tx = dx / d; tz = dz / d; sp = d < 12 ? 4.2 : 3.4; }
    const f = fireNear(e.x, e.z, 9); if (f) { const fx = e.x - (f.i + 0.5), fz = e.z - (f.k + 0.5), fl = Math.hypot(fx, fz) || 1; tx = fx / fl; tz = fz / fl; sp = 4; }
    e.vx += (tx * sp - e.vx) * Math.min(1, dt * 6); e.vz += (tz * sp - e.vz) * Math.min(1, dt * 6);
    e.x += (e.vx + e.kx) * dt; e.z += (e.vz + e.kz) * dt; e.kx *= 0.88; e.kz *= 0.88;
    const o = { x: e.x, z: e.z }; pushFromBlocks(o, 0.55, e.y + 1.02, e.y + 1.9); e.x = o.x; e.z = o.z;
    nearChunksAt(e.x, e.z, ch => { for (const c of ch.col) { const ax = e.x - c.x, az = e.z - c.z, dd = Math.hypot(ax, az), md = c.r + 0.55; if (dd < md && dd > 1e-4) { e.x = c.x + ax / dd * md; e.z = c.z + az / dd * md; } } });
    e.y += (floorY(e.x, e.z, e.y) - e.y) * Math.min(1, dt * 12);
    if (sp > 0.1 && !f) e.heading += angDiff(Math.atan2(tx, tz), e.heading) * Math.min(1, dt * 8);
    e.phase += Math.hypot(e.vx, e.vz) * dt * 3; e.cd -= dt;
    if (state === 'play' && !f && d < 1.6 && e.cd <= 0 && Math.abs(P.y - e.y) < 1.4) { e.cd = 1.3; damagePlayer(9 + day * 2, e); }
    e.g.position.set(e.x, e.y + Math.abs(Math.sin(e.phase)) * 0.03, e.z); e.g.rotation.y = e.heading;
    for (const l of e.legs) l.p.rotation.x = Math.sin(e.phase + l.ph) * 0.6;
  }
}
/* ================= wildlife: thistle hares ================= */
const critters = []; let spawnH = 3;
function makeHare() {
  const g = new THREE.Group(), fur = new THREE.MeshStandardMaterial({ color: 0x9b8468, roughness: 0.95 }), lt = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.95 }), dk = new THREE.MeshStandardMaterial({ color: 0x1e1712, roughness: 0.4 });
  const S1 = new THREE.SphereGeometry(1, 12, 10), ball = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(S1, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const body = ball(fur, 0.3, 0.26, 0.46, 0, 0.34, 0); ball(fur, 0.27, 0.25, 0.3, 0, 0.3, -0.24); ball(fur, 0.2, 0.19, 0.24, 0, 0.5, 0.42); ball(lt, 0.09, 0.09, 0.09, 0, 0.36, -0.52);
  for (const sg of [-1, 1]) { const ear = ball(fur, 0.05, 0.25, 0.06, sg * 0.08, 0.78, 0.38); ear.rotation.z = -sg * 0.15; ball(dk, 0.03, 0.035, 0.03, sg * 0.1, 0.54, 0.58); ball(lt, 0.07, 0.07, 0.12, sg * 0.1, 0.16, 0.3); }
  return { g, body };
}
function spawnHare() {
  const a = Math.random() * TAU, d = 22 + Math.random() * 28, x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d, t = WG.terr(Math.floor(x), Math.floor(z));
  if (t.h <= SEA + 2 || t.biome === BIOME.PEAKS || t.biome === BIOME.DUNES || WG.slope(Math.floor(x), Math.floor(z)) >= 2) return;
  const m = makeHare(), c = { x, z, y: surf(x, z), vx: 0, vz: 0, hp: 12, kx: 0, kz: 0, heading: Math.random() * TAU, timer: 0, wa: 0, wander: false, hop: Math.random() * 6, dying: 0, ...m };
  c.g.position.set(x, c.y, z); scene.add(c.g); critters.push(c);
}
function removeCritter(c) { scene.remove(c.g); const i = critters.indexOf(c); if (i >= 0) critters.splice(i, 1); }
function hitCritter(c, ts) {
  c.hp -= ts.dmg; c.kx = (c.x - P.x) * 3; c.kz = (c.z - P.z) * 3; burst(c.x, c.y + 0.4, c.z, 0xb7a080, 6); sfx.squish(); wear(ts);
  if (c.hp <= 0) { c.dying = 0.001; giveItem('meat', 1 + (Math.random() < 0.45 ? 1 : 0)); }
}
function updateCritters(dt) {
  spawnH -= dt;
  if (state === 'play' && TOD.night < 0.25 && ugU < 0.3 && critters.length < 6 && spawnH <= 0) { spawnHare(); spawnH = 4 + Math.random() * 4; }
  for (const c of critters.slice()) {
    if (c.dying) { c.dying += dt; c.g.scale.setScalar(Math.max(0.01, 1 - c.dying * 2)); if (c.dying > 0.5) removeCritter(c); continue; }
    const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz) || 1;
    if (d > 95 || (TOD.night > 0.5 && d > 22)) { removeCritter(c); continue; }
    let tx = 0, tz = 0, sp = 0; c.timer -= dt;
    if (d < 9 && state === 'play') { tx = dx / d; tz = dz / d; sp = 6.5; }
    else { if (c.timer <= 0) { c.timer = 1.5 + Math.random() * 3; c.wa = Math.random() * TAU; c.wander = Math.random() < 0.6; } if (c.wander) { tx = Math.cos(c.wa); tz = Math.sin(c.wa); sp = 1.5; } }
    c.vx += (tx * sp - c.vx) * Math.min(1, dt * 7); c.vz += (tz * sp - c.vz) * Math.min(1, dt * 7);
    const ox = c.x, oz = c.z; c.x += (c.vx + c.kx) * dt; c.z += (c.vz + c.kz) * dt; c.kx *= 0.86; c.kz *= 0.86;
    const o = { x: c.x, z: c.z }; pushFromBlocks(o, 0.35, c.y + 1.02, c.y + 1.6); c.x = o.x; c.z = o.z;
    nearChunksAt(c.x, c.z, ch => { for (const q of ch.col) { const ax = c.x - q.x, az = c.z - q.z, dd = Math.hypot(ax, az), md = q.r + 0.35; if (dd < md && dd > 1e-4) { c.x = q.x + ax / dd * md; c.z = q.z + az / dd * md; } } });
    if (getBlock(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)) === B.WATER || WG.terr(Math.floor(c.x), Math.floor(c.z)).h <= SEA + 1) { c.x = ox; c.z = oz; c.wa += Math.PI; }
    c.y += (floorY(c.x, c.z, c.y) - c.y) * Math.min(1, dt * 12);
    if (sp > 0.1) c.heading += angDiff(Math.atan2(tx, tz), c.heading) * Math.min(1, dt * 9);
    c.hop += Math.hypot(c.vx, c.vz) * dt * (sp > 3 ? 2.2 : 3.5);
    const h = Math.abs(Math.sin(c.hop)) * (sp > 3 ? 0.42 : 0.16); c.g.position.set(c.x, c.y + h, c.z); c.g.rotation.set(0, c.heading, 0); c.body.rotation.x = Math.cos(c.hop) * 0.15 * (sp > 0.1 ? 1 : 0);
  }
}
function nearChunksAt(x, z, fn) { const pcx = Math.round(x / S), pcz = Math.round(z / S); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const ch = chunks.get((pcx + dx) + ',' + (pcz + dz)); if (ch) fn(ch); } }

/* ================= combat and survival ================= */
function damagePlayer(amt, src) {
  if (P.invuln > 0 || state !== 'play') return;
  const sh = bestShield(); let msg = null;
  if (P.blocking && sh && src) {
    const ax = src.x - P.x, az = src.z - P.z, l = Math.hypot(ax, az) || 1, facing = (Math.sin(P.heading) * ax + Math.cos(P.heading) * az) / l;
    if (facing > 0.0) {
      amt *= 1 - ITEMS[sh.id].reduce; sh.dur -= 1; P.stamina = Math.max(0, P.stamina - 10); sfx.clang(); burst(P.x + Math.sin(P.heading) * 0.6, P.y + 1, P.z + Math.cos(P.heading) * 0.6, 0xffe9a0, 6);
      if (sh.dur <= 0) { const i = inv.indexOf(sh); inv[i] = null; toast('Your shield broke', true); updateHeld(); renderHot(); }
      else renderHot();
      if (src.x !== undefined) { src.kx = ax * -0.5 / l * 10; src.kz = az * -0.5 / l * 10; }
    }
  } else { sfx.bite(); dmgFlash = 1; shake = 0.5; }
  P.hp -= amt; P.invuln = 0.45; if (amt > 3) { sfx.hurt(); dmgFlash = Math.max(dmgFlash, 0.8); }
  if (src) { const ax = P.x - src.x, az = P.z - src.z, l = Math.hypot(ax, az) || 1; P.kx = ax / l * 4; P.kz = az / l * 4; }
  if (P.hp <= 0) die();
}
function toolStats() {
  const s = inv[sel], d = s ? ITEMS[s.id] : null;
  if (!d || d.k !== 'tool') return { d: null, chop: CHOP[0], mine: 0, dmg: 2, range: 1.9, blockPow: 0.7 };
  return { d, s, chop: d.tool === 'axe' ? CHOP[d.tier] : CHOP[0], mine: d.tool === 'pick' ? MINE[d.tier] : 0, dmg: DMG[d.tool][d.tier], range: d.tool === 'sword' ? 2.7 : 2.2, blockPow: d.tool === 'axe' ? CHOP[d.tier] : d.tool === 'pick' ? MINE[d.tier] : d.tool === 'shovel' ? DIGP[d.tier] : 1 };
}
function wear(ts) { if (!ts.s) return; ts.s.dur -= 1; if (ts.s.dur <= 0) { const i = inv.indexOf(ts.s); if (i >= 0) inv[i] = null; toast('Your ' + ts.d.n.toLowerCase() + ' broke', true); sfx.brk(); updateHeld(); } renderHot(); }
function startSwing() { P.swing = 0.34; P.swingHit = false; P.cool = 0.42; const cf = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)); P.heading = cf; sfx.swing(); }
function useItem() {
  if (P.cool > 0 || state !== 'play' || uiOpen) return;
  const s = inv[sel], d = s ? ITEMS[s.id] : null, kind = d ? d.k : 'hand';
  if (kind === 'food') {
    if (d.food > 0 && P.hunger >= 99 && d.heal === 0) { toast('You are not hungry'); return; }
    if (d.heal > 0 && P.hp >= 99 && d.food === 0) { toast('You are healthy'); return; }
    P.hunger = Math.min(100, P.hunger + d.food); P.hp = Math.min(100, P.hp + d.heal); s.n--; if (s.n <= 0) inv[sel] = null; P.cool = 0.5; sfx.eat(); renderHot(); updateHeld(); return;
  }
  if (kind === 'block' || kind === 'station') { tryPlace(); return; }
  startSwing();
}
function tryPlace() {
  if (!aim.place || !aim.placeOK) { toast('You cannot place that there', true, 1200); P.cool = 0.25; return; }
  const [i, j, k] = aim.place, s = inv[sel], d = ITEMS[s.id]; if (d.k === 'station') placeStation(i, j, k, d.place); else setVox(i, j, k, d.bid); s.n--; if (s.n <= 0) inv[sel] = null;
  P.cool = 0.22; sfx.place(); renderHot(); updateHeld(); if (d.place === 'camp') tip('camp', 'Beetles avoid the fire. Stay close to it at night.');
}
function resolveSwing() {
  const ts = toolStats(), fx = Math.sin(P.heading), fz = Math.cos(P.heading);
  let best = null, bd = 1e9;
  for (const e of enemies) { if (e.dying) continue; const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz); if (d < ts.range + 0.6 && (dx * fx + dz * fz) / (d || 1) > 0.25 && d < bd) { bd = d; best = e; } }
  if (best) { hitEnemy(best, ts); return; }
  let hb = null, hd = 1e9;
  for (const c of critters) { if (c.dying) continue; const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz); if (d < ts.range + 0.7 && (dx * fx + dz * fz) / (d || 1) > 0.2 && d < hd) { hd = d; hb = c; } }
  if (hb) { hitCritter(hb, ts); return; }
  if (aim.ok && aim.type === 'node' && aim.node) { hitNode(aim.node, ts); return; }
  if (aim.ok && aim.type === 'block' && aim.block) { hitBlock(aim.block, ts); return; }
  if (aim.ok && aim.type === 'ground' && aim.cell) { hitGround(aim.cell, ts); return; }
}
function hitEnemy(e, ts) {
  e.hp -= ts.dmg; e.kx = (e.x - P.x) * 3; e.kz = (e.z - P.z) * 3; sfx.squish(); burst(e.x, e.y + 0.6, e.z, 0x8f6bd6, 8); drawBar(e); wear(ts);
  if (e.hp <= 0) { e.dying = 0.001; if (Math.random() < 0.7) giveItem('shell', 1 + (Math.random() < 0.35 ? 1 : 0)); }
}
function giveItem(id, n) {
  const left = addItem(id, n);
  if (left < n) toast('+' + (n - left) + ' ' + ITEMS[id].n, false, 1300);
  if (left > 0) toast('Your pack is full', true, 1200);
  if (id === 'wood') tip('wood', 'Open your pack with Tab. Turn wood into planks and sticks, then build a workbench.');
  if (id === 'stone') tip('stone', 'Stone plus wood makes a campfire. Rocks need a pickaxe.');
  if (id === 'dirt') tip('dirt', 'Place dirt to build up land or plug a hole. A shovel digs it fastest.');
  if (id === 'coal') tip('coal', 'Coal plus a stick makes torches. Torches light caves and keep beetles away.');
  if (id === 'crystal') tip('crystal', 'Glow crystals shine on their own. Place them anywhere for light.');
  if (id === 'meat') tip('meat', 'Roast raw meat over a campfire for a big meal.');
  if (id === 'ore') tip('ore', 'Smelt iron ore in a furnace next to a workbench.');
}
function hitNode(n, ts) {
  n.shake = 0.25;
  if (n.kind === 'tree') {
    n.hp -= ts.chop; sfx.chop(); burst(n.x, n.y0 + 1.1, n.z, n.cactus ? 0x3f9a4a : 0xb98450, 5); if (ts.d && ts.d.tool === 'axe') wear(ts);
    if (n.hp <= 0) fellTree(n);
  } else if (n.kind === 'rock' || n.kind === 'ore') {
    const need = n.kind === 'ore' ? 2 : 1, tier = ts.d && ts.d.tool === 'pick' ? ts.d.tier : 0;
    if (tier < need) { sfx.clang(); toast(need === 2 ? 'Iron ore needs a stone pickaxe or better' : 'You need a pickaxe to break stone', true, 1500); burst(n.x, n.y0 + 0.8, n.z, 0xcccccc, 3); return; }
    n.hp -= ts.mine; sfx.mine(); burst(n.x, n.y0 + 0.9, n.z, n.kind === 'ore' ? 0xd9762a : 0xbfbfbf, 6); wear(ts);
    if (n.hp <= 0) { n.dead = true; deadNodes.add(nk(n)); n.mesh.visible = false; nearChunks(ch => { ch.col = ch.col.filter(c => c.node !== n); }); giveItem(n.kind === 'ore' ? 'ore' : 'stone', n.yield); sfx.brk(); }
  } else if (n.kind === 'bush') harvestBush(n);
}
const falling = [];
function fellTree(n) {
  n.dead = true; deadNodes.add(nk(n)); nearChunks(ch => { const c = ch.col.find(c => c.node === n); if (c) { c.r = Math.max(0.5, n.r * 0.9); c.node = null; } });
  const dx = n.x - P.x, dz = n.z - P.z, l = Math.hypot(dx, dz) || 1; falling.push({ m: n.mesh, t: 0, ax: dz / l, az: -dx / l, x: n.x, z: n.z });
  const st = new THREE.Mesh(G.stump, MAT.vc); st.position.set(n.x, n.y0 - 0.1, n.z); st.scale.set(n.r, n.r * 0.8, n.r); st.castShadow = true; st.receiveShadow = true;
  if (!n.cactus) nearChunks(ch => { if (ch.nodes.indexOf(n) >= 0) ch.grp.add(st); });
  sfx.brk(); giveItem(n.item || 'wood', n.yield);
}
function harvestBush(n) {
  if (!n.ready) { toast('The bush has no berries right now'); return; }
  n.ready = false; n.regrow = 90; n.mesh.geometry = G.bush; giveItem('berries', 2 + ((Math.random() * 3) | 0)); sfx.pickup(); tip('berry', 'Berries keep your hunger up. Cook mushrooms at a campfire for more.');
}
function hitBlock(b, ts) {
  const def = BDEF[b.t], pow = ts.d && ts.d.tool === def.tool ? ts.blockPow : 0.7; b.hp -= pow; sfx.chop(); burst(b.i + 0.5, b.j + 0.6, b.k + 0.5, b.t === 'brick' ? 0xaaaaaa : 0xc69258, 5);
  if (ts.d && ts.d.tool === def.tool) wear(ts);
  if (b.hp <= 0) { removeStation(b); giveItem(def.item, 1); sfx.brk(); }
}
function powerFor(ts, kind) { const d = ts.d; if (!d) return 0.6; if (d.tool === kind) return kind === 'axe' ? CHOP[d.tier] : kind === 'pick' ? MINE[d.tier] : DIGP[d.tier]; if (kind === 'shovel' && d.tool === 'pick') return MINE[d.tier] * 0.8; return 0.6; }
function rootsBlock(i, k) {
  const x = i + 0.5, z = k + 0.5; let hit = false;
  nearChunksAt(x, z, ch => { for (const c of ch.col) if (Math.hypot(x - c.x, z - c.z) < c.r + 0.75) hit = true; for (const n of ch.nodes) if (!n.dead && n.kind === 'bush' && Math.hypot(x - n.x, z - n.z) < n.r + 0.75) hit = true; });
  return hit;
}
function removeScenery(i, k) { const ch = chunks.get(Math.floor((i + S / 2) / S) + ',' + Math.floor((k + S / 2) / S)); if (ch) removeSceneryIn(ch, i, k); }
function removeSceneryIn(ch, i, k) {
  for (const m of ch.scen) { const xz = m.userData.xz; let ch2 = false; for (let q = 0; q < xz.length / 2; q++) if (Math.floor(xz[q * 2]) === i && Math.floor(xz[q * 2 + 1]) === k) { m.setMatrixAt(q, ZERO); ch2 = true; } if (ch2) m.instanceMatrix.needsUpdate = true; }
  for (const p of ch.picks) if (!p.dead && Math.floor(p.x) === i && Math.floor(p.z) === k) { p.dead = true; collected.add(p.id); }
}
function hitGround(c, ts) {
  const i = c[0], j = c[1], k = c[2], id = getBlock(i, j, k), bd = BLOCK[id];
  if (!bd || bd.hp === Infinity) { sfx.clang(); toast('Bedrock cannot be broken', true, 1300); return; }
  if (bd.need > 0) {
    const tier = ts.d && ts.d.tool === 'pick' ? ts.d.tier : 0;
    if (tier < bd.need) { sfx.clang(); toast(bd.need >= 2 ? bd.n + ' needs a stone pickaxe or better' : bd.n + ' needs a pickaxe', true, 1500); burst(i + 0.5, j + 1, k + 0.5, 0xcccccc, 3); return; }
  }
  if (j === WG.terr(i, k).h - 1 && rootsBlock(i, k)) { sfx.clang(); toast('Roots and rocks hold this ground together', true, 1600); return; }
  const kk = key(i, j, k); if (!mining || mining.key !== kk) mining = { key: kk, hp: bd.hp, max: bd.hp };
  mining.hp -= powerFor(ts, bd.tool); sfx.dig(); burst(i + 0.5, j + 1, k + 0.5, BCOL[id] || 0x888888, 6);
  if (ts.d && ts.d.tool !== 'sword') wear(ts);
  tip('dig', 'Dirt can be placed like blocks to raise the ground. Tunnels must be two blocks tall for you to fit.');
  if (mining && mining.hp <= 0) { mining = null; digCell(i, j, k, id); }
}
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function touchesWater(i, j, k) { for (const n of NB6) if (getBlock(i + n[0], j + n[1], k + n[2]) === B.WATER) return true; return false; }
function floodFrom(i, j, k) {
  if (j > SEA || !touchesWater(i, j, k)) return;
  const q = [[i, j, k]]; let n = 0;
  while (q.length && n < 600) {
    const c = q.pop(); if (c[1] > SEA || getBlock(c[0], c[1], c[2]) !== 0 || !touchesWater(c[0], c[1], c[2])) continue;
    setVox(c[0], c[1], c[2], B.WATER); n++; for (const d of NB6) q.push([c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
  }
}
function digCell(i, j, k, id) {
  setVox(i, j, k, 0); if (j === WG.terr(i, k).h - 1) removeScenery(i, k);
  const drop = BLOCK[id].drop; if (drop) giveItem(drop, 1); sfx.brk(); floodFrom(i, j, k);
}
function interact() {
  if (state !== 'play') return;
  if (uiOpen) { toggleInv(false); return; }
  if (aim.type === 'node' && aim.node && aim.node.kind === 'bush' && aim.ok) { harvestBush(aim.node); return; }
  if (aim.type === 'block' && aim.block && aim.ok) {
    const t = aim.block.t;
    if (t === 'bench' || t === 'furnace' || t === 'camp') { toggleInv(true); return; }
    if (t === 'bed') { sleep(aim.block); return; }
  }
  toggleInv(true);
}
function sleep(b) {
  if (TOD.night < 0.25) { toast('You can only sleep at night', true); return; }
  for (const e of enemies) if (!e.dying && Math.hypot(e.x - P.x, e.z - P.z) < 16) { toast('Beetles are too close to sleep', true); return; }
  $('fade').classList.add('on'); state = 'sleep';
  setTimeout(() => {
    todT = (Math.floor(todT / DAY_LEN) + 1) * DAY_LEN + 0.1 * DAY_LEN; P.hp = 100; P.hunger = Math.max(25, P.hunger - 15); P.spawnX = b.i + 0.5; P.spawnZ = b.k + 2;
    for (const e of enemies.slice()) removeEnemy(e);
    $('fade').classList.remove('on'); state = 'play'; toast('You wake at dawn, rested');
  }, 900);
}
function die() {
  state = 'dead'; if (document.exitPointerLock) document.exitPointerLock();
  $('over').classList.remove('hidden'); $('overTitle').textContent = 'The night wins this round';
  $('overText').textContent = 'You dropped half of your gathered resources. Your tools and shields are still with you.';
  $('overBtn').textContent = 'Wake up';
}
function respawn() {
  for (const s of inv) if (s && ITEMS[s.id].stack > 1) s.n = Math.ceil(s.n / 2);
  P.hp = 100; P.hunger = Math.max(P.hunger, 60); P.x = P.spawnX; P.z = P.spawnZ; P.y = surf(P.x, P.z); P.vx = P.vz = P.vy = 0; P.grounded = true; P.invuln = 2;
  todT = (Math.floor(todT / DAY_LEN) + 1) * DAY_LEN + 0.1 * DAY_LEN; for (const e of enemies.slice()) removeEnemy(e);
  $('over').classList.add('hidden'); state = 'play'; renderHot(); updateHeld();
}
function pickups() {
  nearChunks(ch => {
    for (const p of ch.picks) {
      if (p.dead) continue; const a = P.x - p.x, b = P.z - p.z;
      if (a * a + b * b < 1.5 && Math.abs(P.y - H(p.x, p.z)) < 1.6) {
        if (!canHold(p.item, 1)) { if (!pickups.t || performance.now() - pickups.t > 2000) { pickups.t = performance.now(); toast('Your pack is full', true, 1200); } continue; }
        p.dead = true; collected.add(p.id); p.mesh.setMatrixAt(p.idx, ZERO); p.mesh.instanceMatrix.needsUpdate = true; giveItem(p.item, 1); sfx.pickup();
      }
    }
  });
}
const tips = {};
function tip(k, text) { if (tips[k]) return; tips[k] = 1; setTimeout(() => toast(text, false, 4200), 900); }
let toastTimer = 0;
function toast(text, bad, ms) { const el = $('toast'); el.textContent = text; el.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, ms || 2600); }

/* ================= input ================= */
const isTouch = matchMedia('(pointer:coarse)').matches;
const joy = { active: false, id: null, cx: 0, cy: 0, x: 0, y: 0 }; let touchRun = false, touchJump = false, touchBlock = false, look = null;
addEventListener('keydown', e => {
  if (e.repeat && e.code !== 'KeyF') { if (['Space', 'Tab'].includes(e.code)) e.preventDefault(); return; }
  keys[e.code] = true;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (state !== 'play' && state !== 'menu') return;
  if (e.code === 'Tab' || e.code === 'KeyI' || e.code === 'KeyC') { if (state === 'play') toggleInv(); }
  else if (e.code === 'Escape' && uiOpen) toggleInv(false);
  else if (e.code === 'KeyE' && state === 'play') interact();
  else if (e.code === 'KeyM') { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; }
  else if (e.code === 'BracketRight') camDist = clamp(camDist + 0.8, 3, 14); else if (e.code === 'BracketLeft') camDist = clamp(camDist - 0.8, 3, 14);
  else if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5), 10); if (n >= 1 && n <= 8) { sel = n - 1; renderHot(); updateHeld(); } }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseHeld = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; $('xh').classList.toggle('on', locked || isTouch); });
document.addEventListener('pointerlockerror', () => { locked = false; });
document.addEventListener('mousemove', e => {
  mouseX = e.clientX; mouseY = e.clientY;
  if (locked) { camYaw -= e.movementX * 0.0026; camPitch = clamp(camPitch + e.movementY * 0.0022, -0.15, 1.3); }
  else if (look && look.mouse) { camYaw -= (e.clientX - look.x) * 0.006; camPitch = clamp(camPitch + (e.clientY - look.y) * 0.005, -0.15, 1.3); look.x = e.clientX; look.y = e.clientY; }
});
const stickBase = $('stickBase'), stickKnob = $('stickKnob');
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  if (e.pointerType === 'touch') {
    canvas.setPointerCapture(e.pointerId);
    if (e.clientX < innerWidth * 0.4 && !joy.active) { joy.active = true; joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY; joy.x = joy.y = 0; stickBase.style.display = 'block'; stickBase.style.left = e.clientX + 'px'; stickBase.style.top = e.clientY + 'px'; stickKnob.style.transform = 'translate(0,0)'; }
    else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    return;
  }
  if (!locked && e.button === 0 && canvas.requestPointerLock) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) {} }
  if (e.button === 2) { if (locked) touchBlock = true; else look = { mouse: true, x: e.clientX, y: e.clientY }; }
  if (e.button === 0) { mouseHeld = true; useItem(); }
});
addEventListener('pointerup', e => {
  if (e.button === 0) mouseHeld = false;
  if (e.button === 2) { touchBlock = false; if (look && look.mouse) look = null; }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'touch') return;
  if (joy.active && e.pointerId === joy.id) {
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy; const l = Math.hypot(dx, dy), m = 56; if (l > m) { dx = dx / l * m; dy = dy / l * m; }
    joy.x = dx / m; joy.y = -dy / m; stickKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  } else if (look && e.pointerId === look.id) { camYaw -= (e.clientX - look.x) * 0.006; camPitch = clamp(camPitch + (e.clientY - look.y) * 0.005, -0.15, 1.3); look.x = e.clientX; look.y = e.clientY; }
});
const endPtr = e => { if (e.pointerType !== 'touch') return; if (joy.active && e.pointerId === joy.id) { joy.active = false; joy.x = joy.y = 0; stickBase.style.display = 'none'; } if (look && e.pointerId === look.id) look = null; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
addEventListener('wheel', e => { if (uiOpen || state !== 'play') return; sel = (sel + (e.deltaY > 0 ? 1 : 7)) % 8; renderHot(); updateHeld(); e.preventDefault(); }, { passive: false });
const bind = (id, down, up) => { const el = $(id); el.addEventListener('pointerdown', e => { e.preventDefault(); down(); }); const u = () => { if (up) up(); }; el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u); el.addEventListener('pointerleave', u); };
bind('tUse', () => { mouseHeld = true; useItem(); }, () => { mouseHeld = false; }); bind('tJump', () => { touchJump = true; }); bind('tBlock', () => { touchBlock = true; }, () => { touchBlock = false; });
bind('tRun', () => { touchRun = true; }, () => { touchRun = false; }); bind('tE', () => { interact(); }); bind('tBag', () => { if (state === 'play') toggleInv(); });

/* ================= player update ================= */
function updatePlayer(dt) {
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  if (uiOpen) { ix = iz = 0; }
  if (joy.active) { ix += joy.x; iz += joy.y; }
  if (blocks.size && iz !== 0) { const lb0 = blocks.get(key(Math.floor(P.x), Math.floor(P.y + 0.05), Math.floor(P.z))) || blocks.get(key(Math.floor(P.x), Math.floor(P.y + 0.75), Math.floor(P.z))); if (lb0 && lb0.t === 'ladder') iz = 0; }
  const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
  const sy = Math.sin(camYaw), cy = Math.cos(camYaw), dx = -sy * iz + cy * ix, dz = -cy * iz - sy * ix;
  const wantRun = (keys.ShiftLeft || keys.ShiftRight || touchRun) && len > 0.1;
  if (P.exhausted && P.stamina > 25) P.exhausted = false;
  P.blocking = !uiOpen && (keys.KeyF || touchBlock) && !!bestShield() && P.stamina > 3;
  const running = wantRun && !P.exhausted && P.stamina > 0 && !P.blocking;
  if (running) { P.stamina -= 22 * dt; if (P.stamina <= 0) { P.stamina = 0; P.exhausted = true; } } else P.stamina = Math.min(100, P.stamina + (len > 0.1 ? 10 : 20) * dt * (P.blocking ? 0.3 : 1));
  const wx = Math.floor(P.x), wz = Math.floor(P.z), wet = getBlock(wx, Math.floor(P.y + 0.7), wz) === B.WATER, lava = getBlock(wx, Math.floor(P.y + 0.3), wz) === B.LAVA || getBlock(wx, Math.floor(P.y + 1.0), wz) === B.LAVA;
  const speed = (running ? 8.4 : 4.8) * (P.blocking ? 0.55 : 1) * (P.swing > 0 ? 0.7 : 1) * (wet ? 0.55 : 1) * (lava ? 0.4 : 1), k = Math.min(1, dt * 12);
  P.vx += (dx * speed - P.vx) * k; P.vz += (dz * speed - P.vz) * k;
  P.x += (P.vx + P.kx) * dt; P.z += (P.vz + P.kz) * dt; P.kx *= 0.85; P.kz *= 0.85;
  const sp = Math.hypot(P.vx, P.vz); P.speed = sp;
  if ((P.swing > 0 || P.blocking) && !uiOpen) { P.heading += angDiff(Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)), P.heading) * Math.min(1, dt * 16); }
  else if (len > 0.1 && sp > 0.5) P.heading += angDiff(Math.atan2(P.vx, P.vz), P.heading) * Math.min(1, dt * 12);
  const push = c => { const ddx = P.x - c.x, ddz = P.z - c.z, d = Math.hypot(ddx, ddz), md = c.r + PRAD; if (d < md && d > 1e-4) { P.x = c.x + ddx / d * md; P.z = c.z + ddz / d * md; } };
  nearChunks(ch => { for (const c of ch.col) push(c); });
  pushFromBlocks(P, PRAD, P.y + 0.03, P.y + PHGT);

  const S0 = surfaceY(P.x, P.z, P.y);
  const lb = blocks.size ? (blocks.get(key(wx, Math.floor(P.y + 0.05), wz)) || blocks.get(key(wx, Math.floor(P.y + 0.75), wz))) : null, ladder = !!lb && lb.t === 'ladder';
  if (ladder && !uiOpen) {
    const up = keys.KeyW || keys.Space || keys.ArrowUp || joy.y > 0.4 || touchJump, dn = keys.KeyS || keys.ArrowDown || joy.y < -0.4;
    if (up || dn) { P.grounded = false; P.vy = up ? 3.8 : -3.8; } else if (!P.grounded) P.vy = 0;
  } else if ((keys.Space || touchJump) && !uiOpen) { if (wet) { P.vy = 4.6; P.grounded = false; } else if (P.grounded) { P.vy = 11.3; P.grounded = false; sfx.jump(); } }
  touchJump = false;
  if (P.grounded) { if (S0 < P.y - 0.4) P.grounded = false; else P.y = S0; }
  if (!P.grounded) {
    P.vy = Math.max(wet ? -3.2 : -30, P.vy - (ladder ? 0 : wet ? 9 : 30) * dt); let ny = P.y + P.vy * dt;
    if (P.vy > 0) { const cj = ceilingAt(P.x, P.z, P.y + PHGT - 0.05, ny + PHGT + 0.05); if (cj !== null) { P.vy = 0; ny = Math.min(ny, cj - PHGT - 0.001); } }
    if (ny <= S0 && P.vy <= 0) { if (P.vy < -17 && !wet) damagePlayer((-P.vy - 17) * 1.6, null); P.y = S0; P.vy = 0; P.grounded = true; } else P.y = ny;
  }
  if (lava) { P.hp -= 30 * dt; dmgFlash = Math.max(dmgFlash, 0.55); shake = Math.max(shake, 0.12); if (Math.random() < dt * 4) sfx.hurt(); if (P.hp <= 0) die(); }
  P.stepD += sp * dt; if (P.grounded && P.stepD > 1.6 && sp > 1) { P.stepD = 0; sfx.step(); }
  if (P.cool > 0) P.cool -= dt; if (P.invuln > 0) P.invuln -= dt;
  if (P.swing > 0) { P.swing -= dt; if (!P.swingHit && P.swing < 0.2) { P.swingHit = true; resolveSwing(); } }
  if (mouseHeld && P.cool <= 0 && !uiOpen) useItem();

  /* hunger and healing */
  P.hunger = Math.max(0, P.hunger - dt * (running ? 0.45 : 0.24));
  if (P.hunger <= 0) { P.hp -= dt * 1.6; if (P.hp <= 0) die(); if (!tips.hungry) tip('hungry', 'You are starving. Eat berries or roasted mushrooms.'); }
  else if (P.hunger > 55 && P.hp < 100) P.hp = Math.min(100, P.hp + dt * 1.1);
  if (P.grounded && H(P.x, P.z) - P.y >= 3) tip('stuck', 'Deep hole? Dig steps into the wall, or jump and place dirt under your feet to climb out.');
  if (TOD.night > 0.4 && !tips.night) tip('night', 'Night has fallen. Gloom beetles roam. Stay by a campfire or behind walls.');
}

/* ================= gnome animation ================= */
function animateGnome(dt, t) {
  const g = gnome.g, sf = clamp(P.speed / 5, 0, 1.4); P.phase += P.speed * dt * 1.9;
  g.position.set(P.x, P.y, P.z); g.rotation.set(0, P.heading, 0);
  gnome.body.position.y = Math.abs(Math.sin(P.phase)) * 0.045 * sf; gnome.body.rotation.z = Math.sin(P.phase) * 0.04 * sf;
  gnome.legs[0].rotation.x = Math.sin(P.phase) * 0.85 * Math.min(1, sf); gnome.legs[1].rotation.x = -Math.sin(P.phase) * 0.85 * Math.min(1, sf);
  if (!P.grounded) { gnome.legs[0].rotation.x = 0.5; gnome.legs[1].rotation.x = -0.4; }
  /* right arm: idle sway or swing */
  if (P.swing > 0) { const s = 1 - P.swing / 0.34, e = 1 - Math.pow(1 - s, 3); gnome.armR.sh.rotation.x = lerp(-2.6, -0.2, e); gnome.armR.sh.rotation.z = 0; }
  else { gnome.armR.sh.rotation.x = -0.3 - Math.sin(P.phase) * 0.55 * sf; gnome.armR.sh.rotation.z = 0.08; }
  /* left arm: shield */
  const sh = bestShield(); const lt = gnome.armL.sh.rotation.x;
  if (P.blocking) { gnome.armL.sh.rotation.x = lerp(lt, -1.35, Math.min(1, dt * 16)); shieldHold.rotation.set(0, 0, 0); shieldHold.position.set(-0.12, 0.05, 0.28); }
  else { gnome.armL.sh.rotation.x = lerp(lt, Math.sin(P.phase) * 0.55 * sf, Math.min(1, dt * 12)); shieldHold.rotation.set(0, Math.PI / 2, 0); shieldHold.position.set(0.16, 0, 0); }
  shieldHold.visible = !!sh;
  const night = TOD.night; gnome.lsp.material.opacity = 0.45 + night * 0.5; gnome.lanternCore.material.color.setRGB(1, 0.75 + Math.sin(t * 9) * 0.03, 0.4);
  g.visible = (P.invuln <= 0 || Math.floor(t * 16) % 2 === 0) && camDistNow > 1.1;
  lantern.position.set(P.x + Math.cos(P.heading) * 0.4, P.y + 1.3, P.z - Math.sin(P.heading) * 0.4);
}

/* ================= camera ================= */
function updateCamera(dt, t) {
  if (state === 'menu') { const a = t * 0.07 + 0.6; camera.position.set(Math.sin(a) * 8, H(0, 0) + 3, 3 + Math.cos(a) * 8); camera.lookAt(0, 1.5, 3); return; }
  const k = Math.min(1, dt * 10); camTarget.x += (P.x - camTarget.x) * k; camTarget.y += (P.y + 1.25 - camTarget.y) * k; camTarget.z += (P.z - camTarget.z) * k;
  const cp = Math.cos(camPitch), cdx = Math.sin(camYaw) * cp, cdy = Math.sin(camPitch), cdz = Math.cos(camYaw) * cp;
  let cd = camDist;
  for (let s2 = 0.4; s2 <= camDist; s2 += 0.2) { if (solid(Math.floor(camTarget.x + cdx * s2), Math.floor(camTarget.y + cdy * s2), Math.floor(camTarget.z + cdz * s2))) { cd = Math.max(0.5, s2 - 0.45); break; } }
  camDistNow += (cd - camDistNow) * Math.min(1, dt * (cd < camDistNow ? 30 : 6));
  camera.position.set(camTarget.x + cdx * camDistNow, camTarget.y + cdy * camDistNow, camTarget.z + cdz * camDistNow);
  const pc = c => { const a = camera.position.x - c.x, b = camera.position.z - c.z, d = Math.hypot(a, b), md = c.r + 0.5; if (d < md && d > 0.001) { camera.position.x = c.x + a / d * md; camera.position.z = c.z + b / d * md; } };
  nearChunks(ch => { for (const c of ch.col) pc(c); });
  if (shake > 0) { shake = Math.max(0, shake - dt * 1.6); camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; }
  camera.lookAt(camTarget);
}

/* ================= world updates ================= */
function updateWorld(dt, t) {
  for (const ch of chunks.values()) for (const n of ch.nodes) {
    if (n.dead) continue;
    if (n.shake > 0) { n.shake -= dt; const s = Math.sin(t * 60) * n.shake * (n.kind === 'tree' ? 0.05 : 0.02); n.mesh.rotation.z = s; n.mesh.rotation.x = s * 0.6; } else if (n.mesh.rotation.z !== 0) { n.mesh.rotation.z = 0; n.mesh.rotation.x = 0; }
    if (n.kind === 'bush' && !n.ready) { n.regrow -= dt; if (n.regrow <= 0) { n.ready = true; n.mesh.geometry = G.bushBerry; } }
  }
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i]; f.t += dt; const a = Math.min(1.55, f.t * f.t * 1.6); f.m.quaternion.setFromAxisAngle(tmpN.set(f.ax, 0, f.az), a);
    if (f.t > 1.6) { const s = Math.max(0.001, 1 - (f.t - 1.6) * 2); f.m.scale.multiplyScalar(0.94); if (f.t > 2.4) { f.m.visible = false; falling.splice(i, 1); } }
  }
  /* stations: flames and lights */
  const lightable = stations.filter(b => b.t === 'camp' || b.t === 'furnace' || b.t === 'torch').map(b => ({ b, d: Math.hypot(b.i + 0.5 - P.x, b.k + 0.5 - P.z) + Math.abs(b.j - P.y) * 0.5 })).sort((a, b) => a.d - b.d);
  for (const b of stations) {
    if (b.t === 'camp' || b.t === 'torch') { const fl = b.obj.userData.flames, f = 1 + Math.sin(t * 13 + b.i) * 0.14 + Math.sin(t * 7.3) * 0.1; fl[0].scale.set(f, 1 + Math.sin(t * 9) * 0.2, f); if (b.t === 'camp') fl[1].scale.set(f * 0.9, 1 + Math.sin(t * 11 + 1) * 0.25, f * 0.9); b.obj.userData.glowSp.scale.setScalar((b.t === 'camp' ? 2.2 : 1.1) + Math.sin(t * 8) * 0.12); }
  }
  for (let i = 0; i < 4; i++) {
    const l = fireLights[i], e = lightable[i];
    if (e && e.d < 40) { const cfg = e.b.t === 'camp' ? [0xff9a3c, 1.9, 24, 0.9] : e.b.t === 'torch' ? [0xffb060, 1.2, 15, 0.9] : [0xff7a20, 0.9, 24, 1.2]; l.position.set(e.b.i + 0.5, e.b.j + cfg[3], e.b.k + 0.5); l.color.set(cfg[0]); l.distance = cfg[2]; l.intensity = cfg[1] * (1 + Math.sin(t * 12 + i * 3) * 0.12); } else l.intensity = 0;
  }
}
function updateAimVisuals() {
  ghost.visible = false; selBox.visible = false;
  const s = inv[sel], d = s ? ITEMS[s.id] : null; let prompt = '';
  if (state !== 'play' || uiOpen) { $('prompt').classList.remove('on'); return; }
  if (d && (d.k === 'block' || d.k === 'station') && aim.place) {
    ghost.visible = true; const [i, j, k] = aim.place; ghost.position.set(i + 0.5, j + 0.5, k + 0.5); ghost.material.color.set(aim.placeOK ? 0x66ff88 : 0xff5544); prompt = aim.placeOK ? 'Place ' + d.n : '';
  } else if (aim.ok && aim.type === 'node' && aim.node) {
    const n = aim.node; prompt = n.kind === 'tree' ? 'Chop tree' : n.kind === 'rock' ? 'Mine stone' : n.kind === 'ore' ? 'Mine iron ore' : (n.ready ? 'Pick berries (E)' : 'Bush is bare');
  } else if (aim.ok && aim.type === 'ground' && aim.cell) {
    const [i, j, k] = aim.cell, id = getBlock(i, j, k), bd = BLOCK[id]; selBox.visible = true; selBox.position.set(i + 0.5, j + 0.5, k + 0.5);
    prompt = id === B.BEDROCK ? 'Bedrock' : bd.need > 0 ? 'Mine ' + bd.n.toLowerCase() + (bd.need >= 2 ? ' (stone pickaxe)' : ' (pickaxe)') : (bd.tool === 'axe' ? 'Chop ' : 'Dig ') + bd.n.toLowerCase();
    if (mining && mining.key === key(i, j, k) && id !== B.BEDROCK) prompt += '  ' + Math.round((1 - mining.hp / mining.max) * 100) + '%';
  } else if (aim.ok && aim.type === 'block' && aim.block) {
    const b = aim.block; selBox.visible = true; selBox.position.set(b.i + 0.5, b.j + 0.5, b.k + 0.5); prompt = b.t === 'bench' ? 'Workbench (E to craft)' : b.t === 'furnace' ? 'Furnace (E to craft)' : b.t === 'camp' ? 'Campfire (E to cook)' : b.t === 'bed' ? 'Bed (E to sleep at night)' : b.t === 'torch' ? 'Pick up torch' : 'Break block';
  } else if (aim.ok && aim.type === 'enemy') prompt = 'Gloom beetle';
  const pe = $('prompt'); if (prompt) { pe.textContent = prompt; pe.classList.add('on'); } else pe.classList.remove('on');
}
function updateHUD() {
  $('hpF').style.width = clamp(P.hp, 0, 100) + '%'; $('fdF').style.width = P.hunger + '%'; $('stF').style.width = P.stamina + '%';
  const p = TOD.p, name = p < 0.1 ? 'Dawn' : p < 0.4 ? 'Daylight' : p < 0.6 ? 'Dusk' : p < 0.92 ? 'Night' : 'Dawn';
  if (updateHUD.n !== name) { updateHUD.n = name; $('clockT').textContent = name; }
  const bn = WG.BIOME_NAME[WG.terr(Math.floor(P.x), Math.floor(P.z)).biome], dpt = Math.max(0, Math.round(H(P.x, P.z) - P.y)), alt = Math.round(P.y);
  const day = 'Day ' + (Math.floor(todT / DAY_LEN) + 1) + '  \u00b7  ' + bn + (dpt > 1 ? '  \u00b7  Depth ' + dpt : alt > 12 ? '  \u00b7  Height ' + alt : '');
  if (updateHUD.d !== day) { updateHUD.d = day; $('clockS').textContent = day; }
  const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], q8 = a => CARD[Math.round((((a % TAU) + TAU) % TAU) / (TAU / 8)) % 8];
  const hx = -P.x, hz = 3 - P.z, hdist = Math.round(Math.hypot(hx, hz)), comp = 'Facing ' + q8(Math.atan2(-Math.sin(camYaw), Math.cos(camYaw))) + (hdist < 15 ? '  \u00b7  Home is close' : '  \u00b7  Home ' + hdist + ' ' + q8(Math.atan2(hx, -hz)));
  if (updateHUD.c !== comp) { updateHUD.c = comp; $('clockC').textContent = comp; }
}

/* ================= saving ================= */
const SAVE_KEY = 'thistlewick-save-v1'; let storageOK = false, hasSave = false, saveT = 30;
try { localStorage.setItem('tw-test', '1'); localStorage.removeItem('tw-test'); storageOK = true; } catch (e) { storageOK = false; }
function peekSave() { if (!storageOK) return false; try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return !!d && d.v === 1; } catch (e) { return false; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
function saveGame() {
  if (!storageOK) return false;
  try {
    const e = []; for (const v of edits.values()) e.push(v.i, v.j, v.k, v.id);
    const d = { v: 1, P: { x: P.x, y: P.y, z: P.z, hp: P.hp, hunger: P.hunger, stamina: P.stamina, heading: P.heading, spawnX: P.spawnX, spawnZ: P.spawnZ }, todT, sel, inv: inv.map(s => s ? [s.id, s.n, s.dur] : null), tips, edits: e,
      stations: stations.map(b => [b.t, b.i, b.j, b.k]), collected: [...collected], dead: [...deadNodes] };
    localStorage.setItem(SAVE_KEY, JSON.stringify(d)); return true;
  } catch (err) { return false; }
}
function loadGame() {
  let d; try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; } if (!d || d.v !== 1) return false;
  try {
    const p = d.P; P.x = p.x; P.z = p.z; P.y = p.y; P.hp = Math.max(20, p.hp); P.hunger = p.hunger; P.stamina = p.stamina; P.heading = p.heading; P.spawnX = p.spawnX; P.spawnZ = p.spawnZ; P.vx = P.vz = P.vy = 0;
    Object.assign(tips, d.tips || {}); for (const id of d.collected || []) collected.add(id); for (const k of d.dead || []) deadNodes.add(k);
    for (let q = 0; q + 3 < d.edits.length; q += 4) setVox(d.edits[q], d.edits[q + 1], d.edits[q + 2], d.edits[q + 3]);
    inv.fill(null); (d.inv || []).forEach((s, i) => { if (s && ITEMS[s[0]] && i < 24) inv[i] = { id: s[0], n: s[1], dur: s[2] }; });
    todT = d.todT; sel = (d.sel | 0) % 8;
    for (const ch of chunks.values()) disposeChunk(ch); chunks.clear();
    ensureChunks(true);
    for (const s of d.stations || []) if (BDEF[s[0]]) placeStation(s[1], s[2], s[3], s[0]);
    if (solid(Math.floor(P.x), Math.floor(P.y + 0.1), Math.floor(P.z)) || solid(Math.floor(P.x), Math.floor(P.y + 1.2), Math.floor(P.z))) P.y = surf(P.x, P.z);
    P.grounded = false; camTarget.set(P.x, P.y + 1.25, P.z);
    return true;
  } catch (err) { return false; }
}
addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') saveGame(); });
addEventListener('pagehide', () => { if (state === 'play') saveGame(); });

/* ================= start, resize, loop ================= */
function startGame(fresh) {
  if (fresh === undefined) fresh = true;
  if (!ready) return; initAudio(); if (AC && AC.state === 'suspended') AC.resume();
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden'); if (isTouch) { $('touch').classList.remove('hidden'); $('xh').classList.add('on'); }
  state = 'play'; camTarget.set(P.x, P.y + 1.25, P.z); renderHot(); updateHeld();
  if (fresh) setTimeout(() => toast('Punch a tree to gather wood. Walk over sticks, stones and fibre to pick them up.', false, 5200), 500);
  else setTimeout(() => toast('Welcome back', false, 1800), 400);
  setTimeout(() => { $('stn').style.opacity = 0.0; }, 22000);
}
$('goBtn').addEventListener('click', () => {
  if (!ready) return;
  if (hasSave) { $('goBtn').disabled = true; $('goBtn').textContent = 'Loading...'; setTimeout(() => { const ok = loadGame(); startGame(!ok); }, 40); } else startGame(true);
});
$('newBtn').addEventListener('click', () => { if (!ready) return; clearSave(); hasSave = false; startGame(true); });
$('overBtn').addEventListener('click', () => { if (state === 'dead') respawn(); });
function resize() {
  renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (composer) composer.setSize(Math.floor(innerWidth * pixelRatio), Math.floor(innerHeight * pixelRatio));
}
addEventListener('resize', resize);
if (composer) resize();

let last = performance.now(), T = 0, perfAcc = 0, perfN = 0, shadowsOn = true;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt; U.time.value = T; perfAcc += dt; perfN++;
  if (perfN >= 120) {
    const avg = perfAcc / perfN; perfAcc = 0; perfN = 0;
    if (avg > 1 / 30 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); resize(); }
    else if (avg > 1 / 24 && shadowsOn) { shadowsOn = false; sun.castShadow = false; if (bloom) bloom.enabled = false; }
  }
  if (state === 'play') { todT += dt; updatePlayer(dt); pickups(); if (dmgFlash > 0) dmgFlash = Math.max(0, dmgFlash - dt * 2.2); }
  else if (state === 'menu') todT += dt * 0.3;
  else if (state === 'sleep') { P.vx *= 0.8; P.vz *= 0.8; P.speed *= 0.8; }
  else { P.vx *= 0.9; P.vz *= 0.9; P.speed *= 0.9; }
  ensureChunks(false);
  { let nb = 0; for (const ch of chunks.values()) if (ch.dirty && nb < 2) { ch.dirty = false; buildGround(ch); nb++; } }
  { let cov = false; if (state === 'play') { const ci = Math.floor(P.x), ck = Math.floor(P.z), j0 = Math.floor(P.y + PHGT); for (let j = j0; j < j0 + 14; j++) if (solid(ci, j, ck)) { cov = true; break; } } ugU += ((cov ? 1 : 0) - ugU) * Math.min(1, dt * 2.5); }
  updateTOD(); updateEnemies(dt, T); updateCritters(dt); updateWorld(dt, T);
  sun.target.position.set(P.x, P.y, P.z); sun.position.set(P.x + TOD.dir.x * 160, P.y + TOD.dir.y * 160, P.z + TOD.dir.z * 160);
  animateGnome(dt, T); updateHeld();
  updateCamera(dt, T); sky.position.copy(camera.position);
  { const wetCam = getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z)) === B.WATER; uwU += ((wetCam ? 1 : 0) - uwU) * Math.min(1, dt * 6);
    const bb = WG.terr(Math.floor(P.x), Math.floor(P.z)).biome; fogD += (FOGT[bb] - fogD) * Math.min(1, dt * 0.4); snowU += ((bb === BIOME.PEAKS || P.y > 30 ? 1 : 0) - snowU) * Math.min(1, dt * 0.8);
    waterTex.offset.set((T * 0.012) % 1, (T * 0.008) % 1); }
  if (state === 'play') { computeAim(); }
  updateAimVisuals(); updateShafts(T); updateMotes(dt, T); updateFlies(dt, T); updateParts(dt);
  for (const e of enemies) if (e.bar) e.bar.visible = !e.dying && e.hp < e.max;
  if (AC && state === 'play' && TOD.night > 0.3 && Math.random() < dt * 0.6) sfx.chirp();
  if (state === 'play') { saveT -= dt; if (saveT <= 0) { saveGame(); saveT = 30; } }
  if (state === 'play' || state === 'dead') updateHUD();
  if (grade) { grade.uniforms.uTime.value = T; grade.uniforms.uDmg.value = dmgFlash * 0.85; grade.uniforms.uVig.value = 0.45 + TOD.night * 0.2 + ugU * 0.15; }
  if (composer) composer.render(dt); else renderer.render(scene, camera);
}
requestAnimationFrame(() => {
  ensureChunks(true); renderHot();
  ready = true; $('goBtn').disabled = false; hasSave = peekSave(); $('goBtn').textContent = hasSave ? 'Continue' : 'Begin'; if (hasSave) $('newBtn').classList.remove('hidden');
});
requestAnimationFrame(frame);
})();
