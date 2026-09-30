/** The original clearing stays safe even after sleeping at a distant bed. */
export const SPAWN_SAFE_RADIUS = 24;
export const BEETLE_NOTICE = 10;
export const BEETLE_LEASH = 16;
export function inSpawnSanctuary(x: number, z: number, padding = 0) {
  return Math.hypot(x, z - 3) <= SPAWN_SAFE_RADIUS + padding;
}
export function beetlePursues(distance: number, chasing: boolean, protectedPlayer: boolean, visible: boolean) {
  return !protectedPlayer && visible && distance < (chasing ? BEETLE_LEASH : BEETLE_NOTICE);
}
/** Sample between bodies; solid terrain, doors and walls break line of sight. */
export function clearSight(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, solid: (x: number, y: number, z: number) => boolean) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 3);
  for (let n = 1; n < steps; n++) {
    const t = n / steps;
    if (solid(Math.floor(a.x + (b.x - a.x) * t), Math.floor(a.y + (b.y - a.y) * t + 0.8), Math.floor(a.z + (b.z - a.z) * t))) return false;
  }
  return true;
}
