import type * as THREE from 'three';
import type { StationKind } from './items';

export interface Slot { id: string; n: number; dur?: number }
export interface Station { t: StationKind; i: number; j: number; k: number; hp: number; obj: THREE.Group | null; ns: boolean }
export interface Edit { i: number; j: number; k: number; id: number }

export type Rgb = number[];
export interface MeshBuf { p: number[]; n: number[]; u: number[]; c: number[]; i: number[] }
export type Reader = (i: number, j: number, k: number) => number;
export interface SceneNode {
  kind: 'tree' | 'rock' | 'ore' | 'bush'; cactus?: boolean; item?: string;
  x: number; z: number; y0: number; r: number; h: number; hp: number; max: number; yield?: number;
  mesh: THREE.Mesh; dead: boolean; shake: number; ry?: number; sc?: number; ready?: boolean; regrow?: number; id?: string;
}
export interface Collider { x: number; z: number; r: number; node?: SceneNode | null }
export interface Pickup { x: number; z: number; item: string; id: string; dead: boolean; mesh: THREE.InstancedMesh; idx: number }
export interface ChunkMeshes { top: THREE.Mesh | null; atlas: THREE.Mesh | null; glow: THREE.Mesh | null; water: THREE.Mesh | null }
export interface Chunk {
  cx: number; cz: number; grp: THREE.Group; col: Collider[]; nodes: SceneNode[]; picks: Pickup[];
  disp: THREE.InstancedMesh[]; scen: THREE.InstancedMesh[]; dirty: boolean; gm: ChunkMeshes;
}
export interface Instance { m: THREE.Matrix4; r: number; g: number; b: number }

export interface Enemy {
  x: number; z: number; y: number; cave: boolean; vx: number; vz: number; hp: number; max: number; cd: number; heading: number; phase: number;
  dying: number; burn: number; kx: number; kz: number;
  g: THREE.Group; legs: { p: THREE.Group; ph: number }[]; bar: THREE.Sprite; cv: HTMLCanvasElement; tex: THREE.CanvasTexture;
}
export interface Critter {
  x: number; z: number; y: number; vx: number; vz: number; hp: number; kx: number; kz: number; heading: number; timer: number; wa: number; wander: boolean; hop: number; dying: number;
  g: THREE.Group; body: THREE.Mesh;
}
export interface Aim {
  type: 'node' | 'enemy' | 'block' | 'ground' | null; cell: number[] | null; ok: boolean; place: number[] | null; placeOK: boolean;
  pt: THREE.Vector3; node: SceneNode | null; block: Station | null; enemy: Enemy | null;
}
export interface ToolStats { d: import('./items').ItemDef | null; s?: Slot | null; chop: number; mine: number; dmg: number; range: number; blockPow: number }
export interface Particle { life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number }

