import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { $ } from '../dom';
import { createTextures } from './textures';
import { CAMERA_FAR } from '../constants';

/* ================= renderer, scene, lights, post ================= */
export const canvas = $('c') as HTMLCanvasElement;
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
export const view = { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.75) };
renderer.setPixelRatio(view.pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#b3c78c');
scene.fog = new THREE.FogExp2('#b3c78c', 0.0045);
export const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, CAMERA_FAR);
scene.add(camera);

export const hemi = new THREE.HemisphereLight(0xdff0b4, 0x403a22, 0.8); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff0c0, 1.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
{ const c = sun.shadow.camera; c.left = -36; c.right = 36; c.top = 36; c.bottom = -36; c.near = 1; c.far = 420; }
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun); scene.add(sun.target);
export const lantern = new THREE.PointLight(0xffc27a, 0.6, 16, 2); scene.add(lantern);
export const fireLights: THREE.PointLight[] = [];
for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff9a3c, 0, 24, 2); scene.add(l); fireLights.push(l); }

export const U = { time: { value: 0 } };
export const anisotropy = renderer.capabilities.getMaxAnisotropy();

export const GradeShader = {
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
export let composer: EffectComposer | null = null, bloom: UnrealBloomPass | null = null, grade: ShaderPass | null = null;
try {
  const w = Math.floor(innerWidth * view.pixelRatio), h = Math.floor(innerHeight * view.pixelRatio);
  const rt = new THREE.WebGLMultisampleRenderTarget(w, h, { format: THREE.RGBAFormat });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.65, 0.88);
  composer.addPass(bloom);
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
} catch (e) { composer = null; }

export const tex = createTextures(anisotropy);
function swayMat(mat: THREE.Material, amp: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nfloat ph = 0.0;\n#ifdef USE_INSTANCING\nph = instanceMatrix[3].x*0.21 + instanceMatrix[3].z*0.17;\n#endif\nfloat hh = max(position.y, 0.0);\n' +
      'transformed.x += sin(uTime*1.7+ph)*' + amp.toFixed(3) + '*hh*hh*0.12 + sin(uTime*0.6+ph*2.0)*0.02*hh;\ntransformed.z += cos(uTime*1.3+ph*1.4)*' + amp.toFixed(3) + '*hh*hh*0.1;');
  };
  mat.customProgramCacheKey = () => 'sway' + amp; return mat;
}
export const MAT = {
  ground: new THREE.MeshStandardMaterial({ map: tex.ground.map, normalMap: tex.ground.normal, vertexColors: true, roughness: 1, metalness: 0 }),
  grass: swayMat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 1.0),
  fern: swayMat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.6),
  vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
  vc2: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  ore: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a1204 }),
  voxel: new THREE.MeshStandardMaterial({ map: tex.atlasTex, vertexColors: true, roughness: 0.97, metalness: 0 }),
  glow: new THREE.MeshBasicMaterial({ map: tex.atlasTex, vertexColors: true }),
  water: new THREE.MeshStandardMaterial({ map: tex.waterTex, color: 0xcfeaff, transparent: true, opacity: 0.72, roughness: 0.1, metalness: 0.05, depthWrite: false }),
  vcTan: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xe6c88e })
};
MAT.ground.normalScale.set(1.3, 1.3);
