import type * as THREE from 'three';
import type { StationKind } from './items';

export interface Slot { id: string; n: number; dur?: number }
export interface Station { t: StationKind; i: number; j: number; k: number; hp: number; obj: THREE.Group | null; ns: boolean; growth?: number; wet?: boolean; top?: Station; link?: Station; open?: boolean }
export interface Edit { i: number; j: number; k: number; id: number }

export type Rgb = number[];
export interface MeshBuf { p: number[]; n: number[]; u: number[]; c: number[]; i: number[] }
export type Reader = (i: number, j: number, k: number) => number;
export interface SceneNode {
  kind: 'tree' | 'rock' | 'ore' | 'bush'; cactus?: boolean; item?: string;
  x: number; z: number; y0: number; r: number; h: number; hp: number; max: number; yield?: number;
  mesh: THREE.Mesh; dead: boolean; shake: number; ry?: number; sc?: number; ready?: boolean; regrow?: number; id?: string; key?: string;
}
export interface Collider { x: number; z: number; r: number; node?: SceneNode | null }
export interface Pickup { x: number; z: number; item: string; id: string; dead: boolean; mesh: THREE.InstancedMesh; idx: number }
export interface ChunkMeshes { top: THREE.Mesh | null; atlas: THREE.Mesh | null; glow: THREE.Mesh | null; water: THREE.Mesh | null }
export interface Chunk {
  cx: number; cz: number; grp: THREE.Group; col: Collider[]; nodes: SceneNode[]; picks: Pickup[];
  disp: THREE.InstancedMesh[]; scen: THREE.InstancedMesh[]; dirty: boolean; gm: ChunkMeshes;
}
export interface Instance { m: THREE.Matrix4; r: number; g: number; b: number }

import type { BossState } from './systems/boss';
export interface Enemy {
  /** Set only on the Elder Beetle. `base` is its model scale and `rad` its body radius for aiming. */
  boss?: BossState; base?: number; rad?: number;
  x: number; z: number; y: number; cave: boolean; vx: number; vz: number; hp: number; max: number; cd: number; heading: number; phase: number;
  dying: number; burn: number; kx: number; kz: number;
  g: THREE.Group; legs: { p: THREE.Group; ph: number }[]; bar: THREE.Sprite; cv: HTMLCanvasElement; tex: THREE.CanvasTexture;
}
export interface Critter {
  x: number; z: number; y: number; vx: number; vz: number; hp: number; kx: number; kz: number; heading: number; timer: number; wa: number; wander: boolean; hop: number; dying: number;
  g: THREE.Group; body: THREE.Mesh;
}
export interface Aim {
  type: 'node' | 'enemy' | 'block' | 'ground' | 'resident' | 'site' | null; cell: number[] | null; ok: boolean; place: number[] | null; placeOK: boolean;
  pt: THREE.Vector3; node: SceneNode | null; block: Station | null; enemy: Enemy | null; resident: Resident | null; site: StorySitePart | null;
}
export interface StorySitePart { siteId: string; partId: string; x: number; y: number; z: number; g: THREE.Group }
export interface ToolStats { d: import('./items').ItemDef | null; s?: Slot | null; chop: number; mine: number; dmg: number; range: number; blockPow: number }
/** A resident living in a cottage. Friendship lives in the `friends` table so it survives moving out. */
export interface Resident {
  id: string; x: number; y: number; z: number; heading: number; phase: number; wait: number;
  home: [number, number, number]; floor: [number, number, number][]; target: { x: number; z: number } | null;
  g: THREE.Group;
}
export interface Particle { life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number }
