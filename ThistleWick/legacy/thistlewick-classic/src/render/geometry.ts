import * as THREE from 'three';
import { TAU } from '../constants';
import { clamp, lerp, smooth, mulberry32 } from '../math';
const dummy = new THREE.Object3D();
const tmpN = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), tiltQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0), tmpC = new THREE.Color();

export function mergeGeos(parts: GeoPart[]) {
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
function tri(P: number[], C: number[], a: number[], b: number[], c: number[], ca: number[], cb: number[], cc: number[]) { P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); C.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]); }
function finishUpGeo(P: number[], C: number[]) {
  const g = new THREE.BufferGeometry(), n = P.length / 3, Nn = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) Nn[i * 3 + 1] = 1;
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
export const mat4 = (x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) => { dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); return dummy.matrix.clone(); };

function makeGrassGeo(lo: number[], hi: number[], wid: number) {
  const P: number[] = [], C: number[] = [], seg = 4, rows = [];
  for (let i = 0; i <= seg; i++) {
    const y = i / seg, hw = wid * (1 - y * 0.93), cx = 0.34 * y * y;
    rows.push({ l: [cx - hw, y, 0], r: [cx + hw, y, 0], col: [lerp(lo[0], hi[0], y), lerp(lo[1], hi[1], y), lerp(lo[2], hi[2], y)] });
  }
  for (let i = 0; i < seg; i++) { const a = rows[i], b = rows[i + 1]; tri(P, C, a.l, a.r, b.l, a.col, a.col, b.col); tri(P, C, a.r, b.r, b.l, a.col, b.col, b.col); }
  return finishUpGeo(P, C);
}
function makeFernGeo() {
  const P: number[] = [], C: number[] = [], nF = 8, seg = 16;
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
function makeMushroom(kind: string, R0?: number) {
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
function makeRock(seed: number, ore?: boolean) {
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
function makeFlower(kind: string) {
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
function makeGiantTrunk(seed: number) {
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
function makeSpruce(seed: number) {
  const R = mulberry32(seed), parts = [], trunk = new THREE.CylinderGeometry(0.75, 1, 24, 8, 4); trunk.translate(0, 12, 0);
  parts.push({ g: trunk, c: () => { const j = 0.85 + R() * 0.3; return [0.27 * j, 0.19 * j, 0.13 * j]; } });
  for (let i = 0; i < 6; i++) {
    const y = 5 + i * 3.4, r = 6.4 - i * 1.0, h = 5.4, v = 0.85 + R() * 0.3, cg = new THREE.ConeGeometry(r, h, 9, 1);
    const cp = cg.attributes.position; for (let k = 0; k < cp.count; k++) if (cp.getY(k) < 0) cp.setXYZ(k, cp.getX(k) * (0.9 + R() * 0.2), cp.getY(k), cp.getZ(k) * (0.9 + R() * 0.2));
    cg.translate(0, y + h / 2, 0);
    parts.push({ g: cg, flat: true, c: (x: number, yy: number) => { const t = clamp((yy - y) / h, 0, 1); return [lerp(0.07, 0.17, t) * v, lerp(0.22, 0.38, t) * v, lerp(0.09, 0.16, t) * v]; } });
  }
  return mergeGeos(parts);
}
function makeBroad(seed: number, pal: number) {
  const R = mulberry32(seed), parts = [], birch = pal !== 2, trunk = new THREE.CylinderGeometry(0.7, 1, 16, 8, 6); trunk.translate(0, 8, 0);
  parts.push({ g: trunk, c: (x: number, y: number) => { const band = Math.sin(y * 5 + x * 3) > 0.7; return birch ? (band ? [0.15, 0.14, 0.13] : [0.8, 0.78, 0.72]) : [0.28, 0.2, 0.13]; } });
  const palette = pal === 0 ? [[0.86, 0.62, 0.14], [0.78, 0.5, 0.1]] : pal === 1 ? [[0.86, 0.34, 0.1], [0.7, 0.2, 0.08]] : [[0.3, 0.55, 0.15], [0.2, 0.42, 0.12]];
  const blobs = [[0, 15, 0, 5.4], [3.4, 12.5, 1.2, 3.8], [-3.2, 13, -1.4, 4], [0.6, 19.5, 0.4, 3.6], [-0.8, 12, 3.6, 3.4], [1.4, 12.6, -3.6, 3.6]];
  for (const [x, y, z, r] of blobs) {
    const ig = new THREE.IcosahedronGeometry(r, 1), ip = ig.attributes.position;
    for (let i = 0; i < ip.count; i++) { const d = 0.86 + R() * 0.28; ip.setXYZ(i, ip.getX(i) * d, ip.getY(i) * d * 0.85, ip.getZ(i) * d); }
    ig.translate(x, y, z); const c0 = palette[(R() * 2) | 0], v = 0.88 + R() * 0.24;
    parts.push({ g: ig, flat: true, c: (px: number, py: number) => { const t = clamp((py - (y - r)) / (2 * r), 0, 1), l = 0.75 + 0.5 * t; return [c0[0] * v * l, c0[1] * v * l, c0[2] * v * l]; } });
  }
  return mergeGeos(parts);
}
function makeStump() {
  const c = new THREE.CylinderGeometry(0.85, 1.15, 0.8, 9, 1), top = new THREE.CircleGeometry(0.85, 9); top.rotateX(-Math.PI / 2); top.translate(0, 0.4, 0);
  const cc = new THREE.CylinderGeometry(0.85, 1.15, 0.8, 9, 1); cc.translate(0, 0.4, 0); c.translate(0, 0.4, 0);
  return mergeGeos([{ g: cc, c: [0.27, 0.19, 0.12] }, { g: top, c: [0.68, 0.52, 0.32] }]);
}
function makeBush(berries: boolean) {
  const R = mulberry32(31), parts = [];
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU, r = 0.5 + R() * 0.35, ig = new THREE.IcosahedronGeometry(r, 1);
    ig.translate(Math.cos(a) * 0.55, 0.45 + R() * 0.35, Math.sin(a) * 0.55);
    const v = 0.8 + R() * 0.4; parts.push({ g: ig, flat: true, c: (x: number, y: number) => [0.14 * v * (0.7 + y * 0.5), 0.36 * v * (0.7 + y * 0.5), 0.1 * v] });
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
export interface GeoPart { g: THREE.BufferGeometry; m?: THREE.Matrix4; flat?: boolean; up?: boolean; c: number[] | ((x: number, y: number, z: number) => number[]); }

export const G = {
  cactus: makeCactus(), grass: makeGrassGeo([0.11, 0.24, 0.07], [0.5, 0.72, 0.2], 0.055), fiber: makeGrassGeo([0.55, 0.6, 0.22], [0.9, 0.92, 0.5], 0.08),
  fern: makeFernGeo(), mushRed: makeMushroom('red'), mushBrown: makeMushroom('brown'), mushTan: makeMushroom('tan', 3),
  leaf: makeLeafGeo(), twig: makeTwigGeo(), rocks: [makeRock(3), makeRock(9)], rockNode: [makeRock(13), makeRock(17)], oreNode: makeRock(23, true),
  flowerBell: makeFlower('bell'), flowerStar: makeFlower('star'), log: makeLogGeo(), acorn: makeAcornGeo(),
  giant: [makeGiantTrunk(1), makeGiantTrunk(2), makeGiantTrunk(3)],
  trees: [makeSpruce(1), makeSpruce(2), makeBroad(3, 0), makeBroad(4, 1), makeBroad(5, 2)],
  stump: makeStump(), bush: makeBush(false), bushBerry: makeBush(true), pebble: makePebble(), stick: makeStick()
};
