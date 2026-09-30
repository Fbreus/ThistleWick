import * as THREE from 'three';
import { HORIZON_RAD, S } from '../constants';
import { WG } from '../world/worldgen';

/** Surface-only terrain outside loaded voxel chunks. Never used for collision or mining. */
export function createHorizon(scene: THREE.Scene) {
  const meshes = new Map<string, THREE.Mesh>();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const colors = [0x665e38, 0x66943d, 0x798060, 0xdccb8b, 0x467848, 0xe4eced].map(c => new THREE.Color(c));
  const water = new THREE.Color(0x729faa);
  function build(cx: number, cz: number) {
    const step = 4, n = S / step, positions: number[] = [], tint: number[] = [], indices: number[] = [];
    const x0 = cx * S - S / 2, z0 = cz * S - S / 2;
    for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
      const wx = x0 + x * step, wz = z0 + z * step, t = WG.terr(wx, wz);
      const c = t.h <= WG.SEA ? water : colors[t.biome];
      positions.push(wx, Math.max(t.h, WG.SEA + 0.9), wz); tint.push(c.r, c.g, c.b);
    }
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x, b = a + n + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    // Skirts hide small height differences at the detailed/coarse boundary.
    const edge: number[] = [];
    for (let x = 0; x <= n; x++) edge.push(x);
    for (let z = 1; z <= n; z++) edge.push(z * (n + 1) + n);
    for (let x = n - 1; x >= 0; x--) edge.push(n * (n + 1) + x);
    for (let z = n - 1; z > 0; z--) edge.push(z * (n + 1));
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i], b = edge[(i + 1) % edge.length], lo = positions.length / 3;
      for (const v of [a, b]) { positions.push(positions[v * 3], positions[v * 3 + 1] - 8, positions[v * 3 + 2]); tint.push(tint[v * 3], tint[v * 3 + 1], tint[v * 3 + 2]); }
      indices.push(a, b, lo, b, lo + 1, lo);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3)); g.setIndex(indices); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material); mesh.userData.cx = cx; mesh.userData.cz = cz; scene.add(mesh); return mesh;
  }
  return {
    clear() { for (const mesh of meshes.values()) { scene.remove(mesh); mesh.geometry.dispose(); } meshes.clear(); },
    count: () => meshes.size,
    update(x: number, z: number, detailed: ReadonlyMap<string, unknown>, force = false) {
      const cx = Math.round(x / S), cz = Math.round(z / S);
      for (const [key, m] of meshes) {
        if (Math.abs(m.userData.cx - cx) > HORIZON_RAD || Math.abs(m.userData.cz - cz) > HORIZON_RAD || detailed.has(key)) {
          scene.remove(m); m.geometry.dispose(); meshes.delete(key);
        }
      }
      let budget = force ? Infinity : 8;
      for (let r = 0; r <= HORIZON_RAD; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const key = `${cx + dx},${cz + dz}`;
        if (!detailed.has(key) && !meshes.has(key)) { meshes.set(key, build(cx + dx, cz + dz)); if (--budget <= 0) return; }
      }
    }
  };
}
