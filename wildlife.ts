import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeatherType } from '../types/fishing';
import type { TreeSpot } from './trees';

type V3 = [number, number, number];

export interface WildlifeOptions {
  groundHeightAt: (x: number, z: number) => number;
  waterHeightAt: (x: number, z: number) => number;
  treeSpots: TreeSpot[];
  isSoftwareGl: boolean;
}

export interface WildlifeSystem {
  group: THREE.Group;
  update: (dt: number, elapsed: number, nightFactor: number, weather: WeatherType) => void;
  dispose: () => void;
}

interface WorldCtx {
  ground: (x: number, z: number) => number;
  waterY: (x: number, z: number) => number;
  blocked: (x: number, z: number, r: number) => boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function angleDiff(target: number, current: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------------------------
// Geometry builder: merges many primitives into ONE mesh with vertex colours (few draw calls)
// ---------------------------------------------------------------------------------------

const UNIT_SPHERE = new THREE.SphereGeometry(1, 12, 9);

class Builder {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();

  private push(geo: THREE.BufferGeometry, color: number): void {
    const n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    this.c.setHex(color);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = this.c.r;
      arr[i * 3 + 1] = this.c.g;
      arr[i * 3 + 2] = this.c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(geo);
  }

  ellipsoid(color: number, p: V3, s: V3, r: V3 = [0, 0, 0]): void {
    const g = UNIT_SPHERE.clone();
    this.e.set(r[0], r[1], r[2]);
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(p[0], p[1], p[2]), this.q, new THREE.Vector3(s[0], s[1], s[2]));
    g.applyMatrix4(this.m);
    this.push(g, color);
  }

  tube(color: number, a: V3, c: V3, r0: number, r1: number, segs = 6): void {
    const A = new THREE.Vector3(a[0], a[1], a[2]);
    const C = new THREE.Vector3(c[0], c[1], c[2]);
    const dir = C.clone().sub(A);
    const len = dir.length();
    if (len < 1e-5) return;
    dir.normalize();
    const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1);
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const mid = A.clone().add(C).multiplyScalar(0.5);
    this.m.compose(mid, qq, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    this.push(g, color);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged;
  }
}

// ---------------------------------------------------------------------------------------
// Quadrupeds (deer, mountain goat, brown bear)
// ---------------------------------------------------------------------------------------

interface QuadSpec {
  scale: number;
  bodyL: number;
  bodyH: number;
  bodyW: number;
  upper: number;
  lower: number;
  legR: number;
  neckL: number;
  neckR: number;
  headL: number;
  headR: number;
  body: number;
  belly: number;
  leg: number;
  hoof: number;
  head: number;
  muzzle: number;
  hump: number;
  antlers: boolean;
  horns: boolean;
  beard: boolean;
  bigEars: boolean;
  tailColor: number;
  walkSpeed: number;
  stride: number;
  grazeNeck: number;
  grazeHead: number;
  standNeck: number;
  standHead: number;
  walkNeck: number;
  walkHead: number;
  maxHeight: number;
}

interface QuadParts {
  root: THREE.Group;
  bodyG: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  hips: THREE.Group[];
  knees: THREE.Group[];
  restHip: number[];
  restKnee: number[];
}

function buildQuad(spec: QuadSpec, mat: THREE.Material, geos: THREE.BufferGeometry[]): QuadParts {
  const root = new THREE.Group();
  const bodyG = new THREE.Group();
  root.add(bodyG);

  const L = spec.bodyL;
  const H = spec.bodyH;
  const W = spec.bodyW;
  const yHip = spec.upper + spec.lower;
  const by = yHip + H * 0.32;

  // Torso
  const bb = new Builder();
  bb.ellipsoid(spec.body, [0, by, 0], [W / 2, H / 2, L / 2]);
  bb.ellipsoid(spec.body, [0, by + H * 0.04, L * 0.26], [W * 0.52, H * 0.54, L * 0.3]);
  bb.ellipsoid(spec.body, [0, by + H * 0.02, -L * 0.27], [W * 0.5, H * 0.52, L * 0.28]);
  bb.ellipsoid(spec.belly, [0, by - H * 0.24, 0], [W * 0.42, H * 0.28, L * 0.42]);
  if (spec.hump > 0) {
    bb.ellipsoid(spec.body, [0, by + H * 0.38, L * 0.2], [W * 0.46, H * 0.36 * spec.hump, L * 0.26]);
  }
  const bodyGeo = bb.build();
  geos.push(bodyGeo);
  bodyG.add(new THREE.Mesh(bodyGeo, mat));

  // Neck (pivot at shoulders, extends along +Y)
  const neck = new THREE.Group();
  neck.position.set(0, by + H * 0.22, L * 0.4);
  const nb = new Builder();
  nb.tube(spec.head, [0, -spec.neckR * 0.5, 0], [0, spec.neckL, 0], spec.neckR * 1.25, spec.neckR * 0.8, 8);
  const neckGeo = nb.build();
  geos.push(neckGeo);
  neck.add(new THREE.Mesh(neckGeo, mat));
  bodyG.add(neck);

  // Head (pivot at top of neck, extends along +Z)
  const head = new THREE.Group();
  head.position.set(0, spec.neckL, 0);
  const hb = new Builder();
  const hr = spec.headR;
  const hl = spec.headL;
  hb.ellipsoid(spec.head, [0, 0, hl * 0.3], [hr, hr * 0.95, hl * 0.42]);
  hb.ellipsoid(spec.muzzle, [0, -hr * 0.18, hl * 0.78], [hr * 0.58, hr * 0.5, hl * 0.3]);
  hb.ellipsoid(0x16110e, [0, -hr * 0.12, hl * 1.05], [hr * 0.22, hr * 0.18, hr * 0.16]);
  for (const s of [-1, 1]) {
    hb.ellipsoid(0x0d0a08, [s * hr * 0.82, hr * 0.28, hl * 0.42], [hr * 0.17, hr * 0.17, hr * 0.17]);
    const earLen = spec.bigEars ? hr * 1.5 : hr * 0.9;
    hb.ellipsoid(spec.head, [s * hr * 0.78, hr * 0.78, -hl * 0.02], [hr * 0.3, earLen * 0.6, hr * 0.18], [0, 0, s * -0.7]);
    if (spec.antlers) {
      const base: V3 = [s * hr * 0.45, hr * 0.85, -hl * 0.02];
      const mid: V3 = [s * hr * 1.0, hr * 0.85 + 0.28, -hl * 0.12];
      const top: V3 = [s * hr * 1.5, hr * 0.85 + 0.55, -hl * 0.3];
      hb.tube(0xd8ccb0, base, mid, 0.017, 0.012, 5);
      hb.tube(0xd8ccb0, mid, top, 0.012, 0.007, 5);
      hb.tube(0xd8ccb0, [mid[0], mid[1], mid[2]], [mid[0] + s * 0.05, mid[1] + 0.2, mid[2] + 0.16], 0.009, 0.005, 4);
      hb.tube(0xd8ccb0, [top[0], top[1], top[2]], [top[0] - s * 0.05, top[1] + 0.14, top[2] + 0.14], 0.008, 0.004, 4);
      hb.tube(0xd8ccb0, [base[0], base[1] + 0.05, base[2]], [base[0] + s * 0.03, base[1] + 0.18, base[2] + 0.2], 0.009, 0.005, 4);
    }
    if (spec.horns) {
      const b0: V3 = [s * hr * 0.4, hr * 0.85, hl * 0.05];
      const b1: V3 = [s * hr * 0.55, hr * 0.85 + 0.16, -hl * 0.05];
      const b2: V3 = [s * hr * 0.6, hr * 0.85 + 0.26, -hl * 0.28];
      hb.tube(0x1a1714, b0, b1, 0.016, 0.012, 5);
      hb.tube(0x1a1714, b1, b2, 0.012, 0.005, 5);
    }
  }
  if (spec.beard) {
    hb.ellipsoid(0xf4f1e8, [0, -hr * 1.05, hl * 0.5], [hr * 0.16, hr * 0.5, hr * 0.14]);
  }
  const headGeo = hb.build();
  geos.push(headGeo);
  head.add(new THREE.Mesh(headGeo, mat));
  neck.add(head);

  // Tail
  const tail = new THREE.Group();
  tail.position.set(0, by + H * 0.16, -L * 0.5);
  const tb = new Builder();
  tb.ellipsoid(spec.tailColor, [0, -0.04, -0.03], [W * 0.1, 0.09, 0.05], [0.2, 0, 0]);
  const tailGeo = tb.build();
  geos.push(tailGeo);
  tail.add(new THREE.Mesh(tailGeo, mat));
  bodyG.add(tail);

  // Legs: [FL, FR, BL, BR]
  const hips: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  const restHip: number[] = [];
  const restKnee: number[] = [];
  const upperB = new Builder();
  upperB.tube(spec.leg, [0, 0, 0], [0, -spec.upper, 0], spec.legR * 1.3, spec.legR * 0.95, 7);
  const upperGeo = upperB.build();
  geos.push(upperGeo);
  const lowerB = new Builder();
  lowerB.tube(spec.leg, [0, 0, 0], [0, -spec.lower, 0], spec.legR * 0.85, spec.legR * 0.62, 6);
  lowerB.ellipsoid(spec.hoof, [0, -spec.lower + 0.012, 0.012], [spec.legR * 0.9, spec.legR * 0.55, spec.legR * 1.25]);
  const lowerGeo = lowerB.build();
  geos.push(lowerGeo);

  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const side = i % 2 === 0 ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(side * W * 0.3, yHip, front ? L * 0.3 : -L * 0.3);
    hip.add(new THREE.Mesh(upperGeo, mat));
    const knee = new THREE.Group();
    knee.position.set(0, -spec.upper, 0);
    knee.add(new THREE.Mesh(lowerGeo, mat));
    hip.add(knee);
    root.add(hip);
    hips.push(hip);
    knees.push(knee);
    restHip.push(front ? 0 : -0.3);
    restKnee.push(front ? 0 : 0.62);
  }

  root.scale.setScalar(spec.scale);
  return { root, bodyG, neck, head, tail, hips, knees, restHip, restKnee };
}

type QuadState = 'graze' | 'walk' | 'look';

class QuadAnimal {
  root: THREE.Group;
  pos = new THREE.Vector2();
  leader: QuadAnimal | null = null;
  moving = false;

  private spec: QuadSpec;
  private parts: QuadParts;
  private home: { x: number; z: number; r: number };
  private ctx: WorldCtx;
  private heading: number;
  private speed = 0;
  private phase: number;
  private moveBlend = 0;
  private state: QuadState = 'graze';
  private timer: number;
  private target = new THREE.Vector2();
  private neckAng: number;
  private headAlpha: number;
  private bodyPitch = 0;
  private slopePitch = 0;
  private tailT: number;
  private legPhase = [0.25, 0.75, 0.0, 0.5].map((v) => v * Math.PI * 2);

  constructor(
    spec: QuadSpec,
    mat: THREE.Material,
    geos: THREE.BufferGeometry[],
    home: { x: number; z: number; r: number },
    start: [number, number],
    ctx: WorldCtx,
    rnd: () => number,
  ) {
    this.spec = spec;
    this.parts = buildQuad(spec, mat, geos);
    this.root = this.parts.root;
    this.root.rotation.order = 'YXZ';
    this.home = home;
    this.ctx = ctx;
    this.pos.set(start[0], start[1]);
    this.heading = rnd() * Math.PI * 2;
    this.phase = rnd() * Math.PI * 2;
    this.timer = 1 + rnd() * 8;
    this.neckAng = spec.grazeNeck;
    this.headAlpha = spec.grazeHead;
    this.tailT = rnd() * 10;
    this.target.copy(this.pos);
  }

  private pickTarget(): boolean {
    for (let i = 0; i < 14; i++) {
      let tx: number;
      let tz: number;
      if (this.leader) {
        const a = Math.random() * Math.PI * 2;
        const d = 1.8 + Math.random() * 2.6;
        tx = this.leader.pos.x + Math.cos(a) * d;
        tz = this.leader.pos.y + Math.sin(a) * d;
      } else {
        const a = Math.random() * Math.PI * 2;
        const d = 3 + Math.random() * this.home.r;
        tx = this.home.x + Math.cos(a) * d * 0.9;
        tz = this.home.z + Math.sin(a) * d * 0.6;
      }
      const h = this.ctx.ground(tx, tz);
      if (h < 0.45 || h > this.spec.maxHeight) continue;
      if (this.ctx.blocked(tx, tz, 1.4)) continue;
      this.target.set(tx, tz);
      return true;
    }
    return false;
  }

  private nextState(): void {
    const r = Math.random();
    if (this.leader && this.leader.moving) {
      if (this.pickTarget()) {
        this.state = 'walk';
        this.timer = 20;
        return;
      }
    }
    if (r < 0.5 && this.pickTarget()) {
      this.state = 'walk';
      this.timer = 25;
    } else if (r < 0.72) {
      this.state = 'look';
      this.timer = 3 + Math.random() * 4;
    } else {
      this.state = 'graze';
      this.timer = 6 + Math.random() * 12;
    }
  }

  update(dt: number, t: number): void {
    const spec = this.spec;
    const p = this.parts;
    this.timer -= dt;
    this.tailT += dt;

    let wantSpeed = 0;
    if (this.state === 'walk') {
      const dx = this.target.x - this.pos.x;
      const dz = this.target.y - this.pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.7 || this.timer <= 0) {
        this.nextState();
      } else {
        const want = Math.atan2(dx, dz);
        const diff = angleDiff(want, this.heading);
        const turn = THREE.MathUtils.clamp(diff, -1.3 * dt, 1.3 * dt);
        this.heading += turn;
        const turnPenalty = 1 - Math.min(0.8, Math.abs(diff) * 0.7);
        wantSpeed = spec.walkSpeed * turnPenalty * Math.min(1, dist * 0.6 + 0.35);
      }
    } else if (this.timer <= 0) {
      this.nextState();
    }

    // Smooth acceleration
    this.speed = THREE.MathUtils.lerp(this.speed, wantSpeed, Math.min(1, dt * 1.8));
    if (this.speed > 0.02) {
      const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
      const nz = this.pos.y + Math.cos(this.heading) * this.speed * dt;
      const h = this.ctx.ground(nx, nz);
      if (h < 0.3 || this.ctx.blocked(nx, nz, 0.9)) {
        this.speed = 0;
        this.state = 'look';
        this.timer = 2;
      } else {
        this.pos.set(nx, nz);
      }
    }
    this.moving = this.state === 'walk' && this.speed > 0.05;

    this.phase += (dt * this.speed * Math.PI * 2) / spec.stride;
    this.moveBlend = THREE.MathUtils.lerp(this.moveBlend, this.speed > 0.04 ? 1 : 0, Math.min(1, dt * 3));
    const speedNorm = Math.min(1.2, this.speed / spec.walkSpeed);

    // Pose targets
    let nTarget = spec.standNeck;
    let hTarget = spec.standHead;
    let pitchTarget = 0;
    if (this.state === 'graze') {
      nTarget = spec.grazeNeck;
      hTarget = spec.grazeHead + Math.sin(t * 2.2 + this.tailT) * 0.06;
      pitchTarget = 0.16;
    } else if (this.state === 'walk') {
      nTarget = spec.walkNeck;
      hTarget = spec.walkHead;
    } else {
      nTarget = spec.standNeck - 0.1;
      hTarget = spec.standHead - 0.05 + Math.sin(t * 0.8 + this.tailT) * 0.05;
    }
    this.neckAng = THREE.MathUtils.lerp(this.neckAng, nTarget, Math.min(1, dt * 1.6));
    this.headAlpha = THREE.MathUtils.lerp(this.headAlpha, hTarget, Math.min(1, dt * 2.2));
    this.bodyPitch = THREE.MathUtils.lerp(this.bodyPitch, pitchTarget, Math.min(1, dt * 1.5));

    // Legs (lateral-sequence walk)
    const amp = 0.4 * this.moveBlend * speedNorm;
    for (let i = 0; i < 4; i++) {
      const ph = this.phase + this.legPhase[i];
      p.hips[i].rotation.x = p.restHip[i] + Math.sin(ph) * amp;
      const lift = Math.max(0, -Math.cos(ph));
      p.knees[i].rotation.x = p.restKnee[i] + lift * 0.95 * this.moveBlend * speedNorm;
    }

    // Body life: bob, sway, breathing
    const breathe = Math.sin(t * 1.7 + this.tailT) * 0.004;
    p.bodyG.position.y = Math.sin(this.phase * 2) * 0.014 * this.moveBlend + breathe;
    p.bodyG.rotation.z = Math.sin(this.phase) * 0.025 * this.moveBlend;
    p.bodyG.rotation.x = this.bodyPitch;

    const bob = Math.sin(this.phase * 2) * 0.05 * this.moveBlend;
    p.neck.rotation.x = this.neckAng + bob * 0.5;
    p.head.rotation.x = this.headAlpha - this.neckAng + bob;
    p.head.rotation.y = this.state === 'look' ? Math.sin(t * 0.6 + this.tailT * 0.3) * 0.5 : 0;

    p.tail.rotation.z = Math.sin(this.tailT * 5.5) * 0.35 * (Math.sin(this.tailT * 0.4) > 0.6 ? 1 : 0.15);

    // Terrain following
    const gy = this.ctx.ground(this.pos.x, this.pos.y);
    const reach = spec.bodyL * spec.scale * 0.5;
    const fx = this.pos.x + Math.sin(this.heading) * reach;
    const fz = this.pos.y + Math.cos(this.heading) * reach;
    const bx = this.pos.x - Math.sin(this.heading) * reach;
    const bz = this.pos.y - Math.cos(this.heading) * reach;
    const slope = Math.atan2(this.ctx.ground(fx, fz) - this.ctx.ground(bx, bz), reach * 2);
    this.slopePitch = THREE.MathUtils.lerp(this.slopePitch, slope, Math.min(1, dt * 3));

    this.root.position.set(this.pos.x, gy - 0.02, this.pos.y);
    this.root.rotation.y = this.heading;
    this.root.rotation.x = -this.slopePitch * 0.85;
  }
}

const DEER_BASE: QuadSpec = {
  scale: 1,
  bodyL: 1.35,
  bodyH: 0.55,
  bodyW: 0.42,
  upper: 0.48,
  lower: 0.5,
  legR: 0.034,
  neckL: 0.62,
  neckR: 0.075,
  headL: 0.31,
  headR: 0.075,
  body: 0x8a5a36,
  belly: 0xd2b88f,
  leg: 0x70492b,
  hoof: 0x231a14,
  head: 0x7c5434,
  muzzle: 0x3d2d25,
  hump: 0,
  antlers: false,
  horns: false,
  beard: false,
  bigEars: true,
  tailColor: 0xf2e8d6,
  walkSpeed: 0.55,
  stride: 1.15,
  grazeNeck: 2.85,
  grazeHead: 1.45,
  standNeck: 0.55,
  standHead: 0.2,
  walkNeck: 0.75,
  walkHead: 0.3,
  maxHeight: 6,
};

const GOAT_SPEC: QuadSpec = {
  ...DEER_BASE,
  scale: 1,
  bodyL: 0.95,
  bodyH: 0.42,
  bodyW: 0.3,
  upper: 0.3,
  lower: 0.33,
  legR: 0.03,
  neckL: 0.34,
  neckR: 0.065,
  headL: 0.23,
  headR: 0.06,
  body: 0xf1ede2,
  belly: 0xe6e0d0,
  leg: 0xe6e0d0,
  hoof: 0x201a16,
  head: 0xe9e3d3,
  muzzle: 0xcfc6b2,
  horns: true,
  beard: true,
  bigEars: false,
  tailColor: 0xf1ede2,
  walkSpeed: 0.42,
  stride: 0.8,
  grazeNeck: 2.7,
  grazeHead: 1.4,
  standNeck: 0.7,
  standHead: 0.25,
  walkNeck: 0.85,
  walkHead: 0.3,
  maxHeight: 18,
};

const BEAR_SPEC: QuadSpec = {
  ...DEER_BASE,
  scale: 1,
  bodyL: 1.5,
  bodyH: 0.8,
  bodyW: 0.62,
  upper: 0.3,
  lower: 0.32,
  legR: 0.08,
  neckL: 0.3,
  neckR: 0.15,
  headL: 0.36,
  headR: 0.14,
  body: 0x5b3b25,
  belly: 0x4b301d,
  leg: 0x4e321f,
  hoof: 0x1a120c,
  head: 0x5f3f28,
  muzzle: 0x8a6a4a,
  hump: 1,
  bigEars: false,
  tailColor: 0x4b301d,
  walkSpeed: 0.5,
  stride: 1.0,
  grazeNeck: 2.3,
  grazeHead: 1.3,
  standNeck: 0.95,
  standHead: 0.35,
  walkNeck: 1.15,
  walkHead: 0.35,
  maxHeight: 4,
};

// ---------------------------------------------------------------------------------------
// Grey heron (wading)
// ---------------------------------------------------------------------------------------

type HeronState = 'stand' | 'walk' | 'hunt' | 'strike';

class Heron {
  root = new THREE.Group();
  private neckSegs: THREE.Group[] = [];
  private head = new THREE.Group();
  private hips: THREE.Group[] = [];
  private knees: THREE.Group[] = [];
  private pos = new THREE.Vector2();
  private heading: number;
  private state: HeronState = 'stand';
  private timer: number;
  private speed = 0;
  private phase = 0;
  private target = new THREE.Vector2();
  private angles = [0.5, -0.4, 0.3];
  private alpha = 0.25;
  private ctx: WorldCtx;
  private t0: number;

  constructor(mat: THREE.Material, geos: THREE.BufferGeometry[], start: [number, number], ctx: WorldCtx, rnd: () => number) {
    this.ctx = ctx;
    this.pos.set(start[0], start[1]);
    this.heading = rnd() * Math.PI * 2;
    this.timer = 2 + rnd() * 5;
    this.t0 = rnd() * 10;
    this.target.copy(this.pos);
    this.root.rotation.order = 'YXZ';

    const legUpper = 0.26;
    const legLower = 0.3;
    const bodyY = legUpper + legLower + 0.05;

    const bb = new Builder();
    bb.ellipsoid(0x8f9ba3, [0, bodyY, 0], [0.085, 0.1, 0.23], [-0.28, 0, 0]);
    bb.ellipsoid(0x7f8c95, [0, bodyY + 0.02, -0.07], [0.09, 0.07, 0.17], [-0.28, 0, 0]);
    bb.ellipsoid(0xeef1f2, [0, bodyY - 0.03, 0.14], [0.06, 0.09, 0.12], [-0.28, 0, 0]);
    for (const s of [-1, 1]) {
      bb.ellipsoid(0x6b7880, [s * 0.075, bodyY + 0.02, -0.04], [0.025, 0.07, 0.2], [-0.28, 0, 0]);
    }
    bb.tube(0x6b7880, [0, bodyY, -0.2], [0, bodyY - 0.14, -0.34], 0.03, 0.012, 5);
    const bodyGeo = bb.build();
    geos.push(bodyGeo);
    this.root.add(new THREE.Mesh(bodyGeo, mat));

    // Neck chain
    let parent: THREE.Object3D = this.root;
    const segLen = 0.17;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      if (i === 0) seg.position.set(0, bodyY + 0.03, 0.2);
      else seg.position.set(0, segLen, 0);
      const nb = new Builder();
      nb.tube(i === 1 ? 0xe9edee : 0xf1f3f3, [0, -0.012, 0], [0, segLen + 0.012, 0], 0.03 - i * 0.004, 0.024 - i * 0.003, 6);
      if (i === 0) nb.tube(0x2b3238, [0.0, 0.02, -0.01], [0.0, segLen * 0.9, -0.01], 0.008, 0.006, 4);
      const g = nb.build();
      geos.push(g);
      seg.add(new THREE.Mesh(g, mat));
      parent.add(seg);
      parent = seg;
      this.neckSegs.push(seg);
    }
    this.head.position.set(0, segLen, 0);
    const hb = new Builder();
    hb.ellipsoid(0xf2f4f4, [0, 0, 0.03], [0.028, 0.028, 0.07]);
    hb.ellipsoid(0x1d2328, [0, 0.022, -0.02], [0.018, 0.012, 0.06], [0.2, 0, 0]);
    hb.tube(0xd8a840, [0, -0.002, 0.06], [0, -0.012, 0.26], 0.014, 0.004, 5);
    hb.ellipsoid(0xf2c24a, [0.019, 0.008, 0.05], [0.007, 0.007, 0.007]);
    hb.ellipsoid(0xf2c24a, [-0.019, 0.008, 0.05], [0.007, 0.007, 0.007]);
    const headGeo = hb.build();
    geos.push(headGeo);
    this.head.add(new THREE.Mesh(headGeo, mat));
    parent.add(this.head);

    // Legs
    const ub = new Builder();
    ub.tube(0xb0a27a, [0, 0, 0], [0, -legUpper, 0], 0.013, 0.011, 5);
    const upGeo = ub.build();
    geos.push(upGeo);
    const lb = new Builder();
    lb.tube(0xa59870, [0, 0, 0], [0, -legLower, 0], 0.011, 0.008, 5);
    lb.tube(0xa59870, [0, -legLower, 0], [0, -legLower, 0.1], 0.007, 0.005, 4);
    lb.tube(0xa59870, [0, -legLower, 0], [0.035, -legLower, 0.08], 0.006, 0.004, 4);
    lb.tube(0xa59870, [0, -legLower, 0], [-0.035, -legLower, 0.08], 0.006, 0.004, 4);
    const loGeo = lb.build();
    geos.push(loGeo);
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.045, legUpper + legLower + 0.02, -0.02);
      hip.add(new THREE.Mesh(upGeo, mat));
      const knee = new THREE.Group();
      knee.position.set(0, -legUpper, 0);
      knee.add(new THREE.Mesh(loGeo, mat));
      hip.add(knee);
      this.root.add(hip);
      this.hips.push(hip);
      this.knees.push(knee);
    }
  }

  private shallowOk(x: number, z: number): boolean {
    const h = this.ctx.ground(x, z);
    return h > -0.5 && h < -0.1;
  }

  update(dt: number, t: number): void {
    this.timer -= dt;
    let wantSpeed = 0;
    let neckTarget = [0.5, -0.4, 0.3];
    let alphaTarget = 0.25;
    let neckRate = 2.0;

    if (this.state === 'stand') {
      neckTarget = [0.5 + Math.sin(t * 0.5 + this.t0) * 0.06, -0.4, 0.3 + Math.sin(t * 0.7 + this.t0) * 0.05];
      if (this.timer <= 0) {
        const r = Math.random();
        if (r < 0.4) {
          this.state = 'hunt';
          this.timer = 2.5 + Math.random() * 4;
        } else {
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 1.5 + Math.random() * 3.5;
            const tx = this.pos.x + Math.cos(a) * d;
            const tz = this.pos.y + Math.sin(a) * d;
            if (this.shallowOk(tx, tz)) {
              this.target.set(tx, tz);
              this.state = 'walk';
              this.timer = 30;
              break;
            }
          }
          if (this.state !== 'walk') this.timer = 3;
        }
      }
    } else if (this.state === 'hunt') {
      // Crouched, folded neck, patient stare
      neckTarget = [1.05, -1.3, 0.95];
      alphaTarget = 0.55;
      neckRate = 1.5;
      if (this.timer <= 0) {
        this.state = 'strike';
        this.timer = 0.45;
      }
    } else if (this.state === 'strike') {
      neckTarget = [1.5, 0.5, 0.6];
      alphaTarget = 1.3;
      neckRate = 14;
      if (this.timer <= 0) {
        this.state = 'stand';
        this.timer = 3 + Math.random() * 6;
      }
    } else if (this.state === 'walk') {
      neckTarget = [0.62, -0.5, 0.4];
      const dx = this.target.x - this.pos.x;
      const dz = this.target.y - this.pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3 || this.timer <= 0) {
        this.state = 'stand';
        this.timer = 3 + Math.random() * 6;
      } else {
        const diff = angleDiff(Math.atan2(dx, dz), this.heading);
        this.heading += THREE.MathUtils.clamp(diff, -1.1 * dt, 1.1 * dt);
        wantSpeed = 0.16 * (1 - Math.min(0.7, Math.abs(diff)));
      }
    }

    this.speed = THREE.MathUtils.lerp(this.speed, wantSpeed, Math.min(1, dt * 2));
    if (this.speed > 0.01) {
      const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
      const nz = this.pos.y + Math.cos(this.heading) * this.speed * dt;
      if (this.shallowOk(nx, nz)) this.pos.set(nx, nz);
      else {
        this.speed = 0;
        this.state = 'stand';
        this.timer = 2;
      }
    }
    this.phase += dt * this.speed * 9;
    const mv = Math.min(1, this.speed / 0.1);

    for (let i = 0; i < 3; i++) {
      this.angles[i] = THREE.MathUtils.lerp(this.angles[i], neckTarget[i], Math.min(1, dt * neckRate));
      this.neckSegs[i].rotation.x = this.angles[i];
    }
    this.alpha = THREE.MathUtils.lerp(this.alpha, alphaTarget, Math.min(1, dt * neckRate));
    const cum = this.angles[0] + this.angles[1] + this.angles[2];
    this.head.rotation.x = this.alpha - cum;

    for (let i = 0; i < 2; i++) {
      const ph = this.phase + i * Math.PI;
      this.hips[i].rotation.x = Math.sin(ph) * 0.35 * mv;
      this.knees[i].rotation.x = Math.max(0, -Math.cos(ph)) * 0.9 * mv;
    }

    const gy = this.ctx.ground(this.pos.x, this.pos.y);
    this.root.position.set(this.pos.x, gy, this.pos.y);
    this.root.rotation.y = this.heading;
    this.root.rotation.x = this.state === 'hunt' ? 0.18 : this.state === 'strike' ? 0.3 : 0;
  }
}

// ---------------------------------------------------------------------------------------
// Mallard ducks (swimming, dabbling)
// ---------------------------------------------------------------------------------------

class Duck {
  root = new THREE.Group();
  pos = new THREE.Vector2();
  private tilt = new THREE.Group();
  private neck = new THREE.Group();
  private heading: number;
  private speed = 0;
  private target = new THREE.Vector2();
  private timer: number;
  private dabble = 0;
  private dabbleBlend = 0;
  private ctx: WorldCtx;
  private home: { x: number; z: number; r: number };
  private t0: number;
  leader: Duck | null = null;

  constructor(
    mat: THREE.Material,
    geos: THREE.BufferGeometry[],
    male: boolean,
    home: { x: number; z: number; r: number },
    start: [number, number],
    ctx: WorldCtx,
    rnd: () => number,
  ) {
    this.ctx = ctx;
    this.home = home;
    this.pos.set(start[0], start[1]);
    this.heading = rnd() * Math.PI * 2;
    this.timer = rnd() * 6;
    this.t0 = rnd() * 10;
    this.target.copy(this.pos);
    this.root.rotation.order = 'YXZ';

    const bodyCol = male ? 0xaaa89f : 0x8a6a48;
    const breast = male ? 0x6b3b27 : 0x9a7650;
    const wing = male ? 0x8c8a82 : 0x6e5439;
    const bb = new Builder();
    bb.ellipsoid(bodyCol, [0, 0.03, -0.02], [0.1, 0.085, 0.2]);
    bb.ellipsoid(breast, [0, 0.05, 0.1], [0.095, 0.085, 0.1]);
    bb.ellipsoid(male ? 0x1d1d22 : 0x5a4631, [0, 0.07, -0.2], [0.05, 0.05, 0.09], [-0.3, 0, 0]);
    for (const s of [-1, 1]) {
      bb.ellipsoid(wing, [s * 0.085, 0.07, -0.04], [0.03, 0.06, 0.15], [0, 0, s * 0.2]);
      if (male) bb.ellipsoid(0x2a52a8, [s * 0.09, 0.062, -0.06], [0.01, 0.02, 0.05]);
    }
    const bodyGeo = bb.build();
    geos.push(bodyGeo);
    this.tilt.add(new THREE.Mesh(bodyGeo, mat));

    this.neck.position.set(0, 0.1, 0.14);
    const nb = new Builder();
    nb.tube(male ? 0x1f6b3d : 0x9a7a54, [0, 0, 0], [0, 0.11, 0.035], 0.03, 0.022, 6);
    if (male) nb.tube(0xf4f4f0, [0, 0.01, 0.0], [0, 0.03, 0.01], 0.032, 0.03, 6);
    nb.ellipsoid(male ? 0x1f6b3d : 0x8c6e4a, [0, 0.135, 0.06], [0.03, 0.03, 0.05]);
    nb.ellipsoid(male ? 0xd9c24a : 0xc08a3a, [0, 0.128, 0.115], [0.018, 0.009, 0.04]);
    nb.ellipsoid(0x0d0d0d, [0.02, 0.145, 0.07], [0.006, 0.006, 0.006]);
    nb.ellipsoid(0x0d0d0d, [-0.02, 0.145, 0.07], [0.006, 0.006, 0.006]);
    const nGeo = nb.build();
    geos.push(nGeo);
    this.neck.add(new THREE.Mesh(nGeo, mat));
    this.tilt.add(this.neck);
    this.root.add(this.tilt);
  }

  private pickTarget(): void {
    for (let i = 0; i < 12; i++) {
      let tx: number;
      let tz: number;
      if (this.leader) {
        const a = Math.random() * Math.PI * 2;
        const d = 0.7 + Math.random() * 1.6;
        tx = this.leader.pos.x + Math.cos(a) * d;
        tz = this.leader.pos.y + Math.sin(a) * d;
      } else {
        const a = Math.random() * Math.PI * 2;
        const d = 2 + Math.random() * this.home.r;
        tx = this.home.x + Math.cos(a) * d;
        tz = this.home.z + Math.sin(a) * d * 0.5;
      }
      if (this.ctx.ground(tx, tz) < -0.7) {
        this.target.set(tx, tz);
        return;
      }
    }
  }

  update(dt: number, t: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.pickTarget();
      this.timer = 6 + Math.random() * 12;
      if (Math.random() < 0.3) this.dabble = 2.2 + Math.random() * 1.5;
    }
    if (this.dabble > 0) this.dabble -= dt;
    const dabbling = this.dabble > 0;

    const dx = this.target.x - this.pos.x;
    const dz = this.target.y - this.pos.y;
    const dist = Math.hypot(dx, dz);
    let wantSpeed = 0;
    if (dist > 0.5 && !dabbling) {
      const diff = angleDiff(Math.atan2(dx, dz), this.heading);
      this.heading += THREE.MathUtils.clamp(diff, -1.4 * dt, 1.4 * dt);
      wantSpeed = 0.32 * (1 - Math.min(0.7, Math.abs(diff) * 0.6)) * Math.min(1, dist * 0.5 + 0.4);
    }
    this.speed = THREE.MathUtils.lerp(this.speed, wantSpeed, Math.min(1, dt * 1.5));
    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.y + Math.cos(this.heading) * this.speed * dt;
    if (this.ctx.ground(nx, nz) < -0.55) this.pos.set(nx, nz);
    else this.speed = 0;

    this.dabbleBlend = THREE.MathUtils.lerp(this.dabbleBlend, dabbling ? 1 : 0, Math.min(1, dt * 2.5));
    const wy = this.ctx.waterY(this.pos.x, this.pos.y);
    this.root.position.set(this.pos.x, wy - 0.025 + Math.sin(t * 1.3 + this.t0) * 0.006, this.pos.y);
    this.root.rotation.y = this.heading;
    // Tip forward (tail up) while dabbling
    this.root.rotation.x = this.dabbleBlend * 1.0 + Math.sin(t * 1.1 + this.t0) * 0.015;
    this.root.rotation.z = Math.sin(t * 0.9 + this.t0 * 2) * 0.03;
    // Neck pumps gently while swimming, stretches down when dabbling
    this.neck.rotation.x = -0.15 + Math.sin(t * 3 + this.t0) * 0.05 * (this.speed > 0.05 ? 1 : 0.3) + this.dabbleBlend * 0.9;
    this.neck.position.z = 0.14 + Math.sin(t * 3 + this.t0) * 0.008 * Math.min(1, this.speed * 4);
  }
}

// ---------------------------------------------------------------------------------------
// Pond turtle (swims, surfaces for air)
// ---------------------------------------------------------------------------------------

function createShellTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4d5a2c';
  ctx.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(88);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const px = x * 32 + (y % 2) * 16;
      const py = y * 32;
      const g = 70 + rnd() * 30;
      ctx.fillStyle = `rgb(${g * 0.8},${g + 25},${g * 0.45})`;
      ctx.beginPath();
      ctx.moveTo(px + 16, py + 2);
      ctx.lineTo(px + 30, py + 12);
      ctx.lineTo(px + 26, py + 28);
      ctx.lineTo(px + 6, py + 28);
      ctx.lineTo(px + 2, py + 12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(210,190,80,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

class Turtle {
  root = new THREE.Group();
  private flippers: THREE.Group[] = [];
  private neck = new THREE.Group();
  private pos = new THREE.Vector2();
  private heading: number;
  private speed = 0;
  private target = new THREE.Vector2();
  private timer: number;
  private depth = -0.5;
  private surfaceTimer: number;
  private phase = 0;
  private ctx: WorldCtx;
  private t0: number;
  private pitch = 0;

  constructor(
    shellMat: THREE.Material,
    skinMat: THREE.Material,
    geos: THREE.BufferGeometry[],
    start: [number, number],
    ctx: WorldCtx,
    rnd: () => number,
    scale: number,
  ) {
    this.ctx = ctx;
    this.pos.set(start[0], start[1]);
    this.heading = rnd() * Math.PI * 2;
    this.timer = rnd() * 4;
    this.surfaceTimer = 15 + rnd() * 30;
    this.t0 = rnd() * 10;
    this.target.copy(this.pos);
    this.root.rotation.order = 'YXZ';

    const shellGeo = new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
    shellGeo.scale(0.2, 0.1, 0.27);
    geos.push(shellGeo);
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.position.y = 0.01;
    this.root.add(shell);

    const sb = new Builder();
    sb.ellipsoid(0xcfc58a, [0, -0.005, 0], [0.18, 0.025, 0.24]);
    sb.ellipsoid(0x53613a, [0, 0.0, -0.27], [0.03, 0.02, 0.05]);
    const baseGeo = sb.build();
    geos.push(baseGeo);
    this.root.add(new THREE.Mesh(baseGeo, skinMat));

    // Neck + head
    this.neck.position.set(0, 0.03, 0.22);
    const hb = new Builder();
    hb.tube(0x6a7a45, [0, 0, 0], [0, 0.01, 0.07], 0.035, 0.03, 6);
    hb.ellipsoid(0x6a7a45, [0, 0.01, 0.11], [0.04, 0.032, 0.05]);
    hb.ellipsoid(0xc23b2a, [0.036, 0.012, 0.1], [0.008, 0.016, 0.016]);
    hb.ellipsoid(0xc23b2a, [-0.036, 0.012, 0.1], [0.008, 0.016, 0.016]);
    hb.ellipsoid(0xe8d25a, [0.03, 0.02, 0.13], [0.006, 0.006, 0.006]);
    hb.ellipsoid(0xe8d25a, [-0.03, 0.02, 0.13], [0.006, 0.006, 0.006]);
    hb.ellipsoid(0x0a0a0a, [0.022, 0.026, 0.14], [0.007, 0.007, 0.007]);
    hb.ellipsoid(0x0a0a0a, [-0.022, 0.026, 0.14], [0.007, 0.007, 0.007]);
    const headGeo = hb.build();
    geos.push(headGeo);
    this.neck.add(new THREE.Mesh(headGeo, skinMat));
    this.root.add(this.neck);

    // Flippers: [FL, FR, BL, BR]
    const fb = new Builder();
    fb.ellipsoid(0x5f6e3c, [0, 0, 0.07], [0.022, 0.012, 0.09], [0, 0, 0]);
    const fGeo = fb.build();
    geos.push(fGeo);
    const bb = new Builder();
    bb.ellipsoid(0x5f6e3c, [0, 0, -0.045], [0.02, 0.011, 0.065]);
    const bGeo = bb.build();
    geos.push(bGeo);
    const pivots: [number, number, number, boolean][] = [
      [-0.17, 0.0, 0.14, true],
      [0.17, 0.0, 0.14, true],
      [-0.14, 0.0, -0.17, false],
      [0.14, 0.0, -0.17, false],
    ];
    for (const [x, y, z, front] of pivots) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.add(new THREE.Mesh(front ? fGeo : bGeo, skinMat));
      this.root.add(g);
      this.flippers.push(g);
    }
    this.root.scale.setScalar(scale);
  }

  private pickTarget(): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 2 + Math.random() * 7;
      const tx = this.pos.x + Math.cos(a) * d;
      const tz = this.pos.y + Math.sin(a) * d;
      const gh = this.ctx.ground(tx, tz);
      if (gh < -0.8 && gh > -3.2 && tz < -1.5 && Math.abs(tx) < 30) {
        this.target.set(tx, tz);
        return;
      }
    }
  }

  update(dt: number, t: number): void {
    this.timer -= dt;
    this.surfaceTimer -= dt;
    if (this.timer <= 0) {
      this.pickTarget();
      this.timer = 8 + Math.random() * 10;
    }
    const surfacing = this.surfaceTimer < 6 && this.surfaceTimer > 0;
    if (this.surfaceTimer <= 0) this.surfaceTimer = 25 + Math.random() * 35;

    const dx = this.target.x - this.pos.x;
    const dz = this.target.y - this.pos.y;
    const dist = Math.hypot(dx, dz);
    let want = 0;
    if (dist > 0.6) {
      const diff = angleDiff(Math.atan2(dx, dz), this.heading);
      this.heading += THREE.MathUtils.clamp(diff, -0.9 * dt, 0.9 * dt);
      // Paddle stroke pulses (power + glide)
      const stroke = 0.5 + 0.5 * Math.sin(this.phase * 1.0);
      want = 0.2 * (0.45 + 0.55 * stroke) * (1 - Math.min(0.6, Math.abs(diff) * 0.5));
    }
    this.speed = THREE.MathUtils.lerp(this.speed, want, Math.min(1, dt * 2));
    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.y + Math.cos(this.heading) * this.speed * dt;
    const gh = this.ctx.ground(nx, nz);
    if (gh < -0.8) this.pos.set(nx, nz);
    else {
      this.speed = 0;
      this.timer = 0;
    }

    this.phase += dt * (1.6 + this.speed * 6);
    const depthTarget = surfacing ? -0.035 : -0.55 + Math.sin(t * 0.25 + this.t0) * 0.12;
    this.depth = THREE.MathUtils.lerp(this.depth, depthTarget, Math.min(1, dt * 0.8));
    const floor = this.ctx.ground(this.pos.x, this.pos.y) + 0.12;
    const y = Math.max(this.depth, floor);

    const pitchTarget = surfacing ? -0.12 : this.speed > 0.05 ? 0.06 : 0;
    this.pitch = THREE.MathUtils.lerp(this.pitch, pitchTarget, Math.min(1, dt * 1.2));

    this.root.position.set(this.pos.x, y, this.pos.y);
    this.root.rotation.y = this.heading;
    this.root.rotation.x = this.pitch;
    this.root.rotation.z = Math.sin(this.phase) * 0.05 * Math.min(1, this.speed * 8);

    // Front flippers row alternately; rear flippers kick gently
    const strokeAmt = Math.min(1, 0.25 + this.speed * 4);
    const s = Math.sin(this.phase);
    this.flippers[0].rotation.set(0.15, 0.7 + s * 0.55 * strokeAmt, -0.2 + s * 0.3 * strokeAmt);
    this.flippers[1].rotation.set(0.15, -0.7 - s * 0.55 * strokeAmt, 0.2 - s * 0.3 * strokeAmt);
    this.flippers[2].rotation.set(0.1, 0.4 - s * 0.35 * strokeAmt, 0);
    this.flippers[3].rotation.set(0.1, -0.4 + s * 0.35 * strokeAmt, 0);
    // Head extends and sweeps slowly while swimming, raised when surfacing
    this.neck.rotation.x = surfacing ? -0.45 : -0.05 + Math.sin(this.phase * 0.5) * 0.06;
    this.neck.rotation.y = Math.sin(t * 0.4 + this.t0) * 0.25;
  }
}

// ---------------------------------------------------------------------------------------
// Public system
// ---------------------------------------------------------------------------------------

export function createWildlife(opts: WildlifeOptions): WildlifeSystem {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const rnd = mulberry32(20240601);

  const animalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mats.push(animalMat);

  const treeR2 = opts.treeSpots;
  const ctx: WorldCtx = {
    ground: opts.groundHeightAt,
    waterY: opts.waterHeightAt,
    blocked: (x, z, r) => {
      for (let i = 0; i < treeR2.length; i++) {
        const s = treeR2[i];
        const rr = s.radius + r;
        const dx = s.x - x;
        const dz = s.z - z;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
      return false;
    },
  };

  const camX = 0;
  const camZ = 2.3;
  const findSpot = (
    test: (x: number, z: number, h: number) => boolean,
    region: { x0: number; x1: number; z0: number; z1: number },
    fallback: [number, number],
  ): [number, number] => {
    for (let i = 0; i < 500; i++) {
      const x = region.x0 + rnd() * (region.x1 - region.x0);
      const z = region.z0 + rnd() * (region.z1 - region.z0);
      const h = opts.groundHeightAt(x, z);
      if (test(x, z, h) && !ctx.blocked(x, z, 1.5)) return [x, z];
    }
    // Second pass: systematic grid scan (ignores trees) so animals never start in the water
    for (let z = region.z0; z <= region.z1; z += 1.5) {
      for (let x = region.x0; x <= region.x1; x += 1.5) {
        if (test(x, z, opts.groundHeightAt(x, z))) return [x, z];
      }
    }
    return fallback;
  };

  const land: THREE.Object3D[] = [];
  const quads: QuadAnimal[] = [];
  const herons: Heron[] = [];
  const ducks: Duck[] = [];
  const turtles: Turtle[] = [];
  const waterLife: THREE.Object3D[] = [];

  const addQuad = (spec: QuadSpec, home: { x: number; z: number; r: number }, start: [number, number]): QuadAnimal => {
    const a = new QuadAnimal(spec, animalMat, geos, home, start, ctx, rnd);
    quads.push(a);
    land.push(a.root);
    group.add(a.root);
    return a;
  };

  // --- Deer herds on the opposite & side shores (visible, 40-80 m from the dock)
  const deerRegions = [
    { x0: -48, x1: -18, z0: -78, z1: -50 },
    { x0: 14, x1: 46, z0: -80, z1: -52 },
  ];
  const farOk = (x: number, z: number): boolean => Math.hypot(x - camX, z - camZ) > 42;
  const herdCount = opts.isSoftwareGl ? 1 : 2;
  for (let hI = 0; hI < herdCount; hI++) {
    const [hx, hz] = findSpot((x, z, h) => h > 0.7 && h < 4.5 && farOk(x, z), deerRegions[hI], [hI === 0 ? -30 : 30, -66]);
    const home = { x: hx, z: hz, r: 9 };
    const leaderSpec: QuadSpec = { ...DEER_BASE, antlers: hI === 0, scale: hI === 0 ? 1.08 : 0.98, body: hI === 0 ? 0x7d5030 : 0x94623a };
    const leader = addQuad(leaderSpec, home, [hx, hz]);
    const mates = opts.isSoftwareGl ? 1 : 3;
    for (let k = 0; k < mates; k++) {
      const isFawn = k === mates - 1 && !opts.isSoftwareGl;
      const spec: QuadSpec = {
        ...DEER_BASE,
        scale: isFawn ? 0.56 : 0.94 + rnd() * 0.06,
        body: isFawn ? 0xa8713f : 0x98663d,
      };
      const [sx, sz] = findSpot((x, z, h) => h > 0.7 && Math.hypot(x - hx, z - hz) < 5, { x0: hx - 5, x1: hx + 5, z0: hz - 5, z1: hz + 5 }, [hx + 2, hz + 1]);
      const a = addQuad(spec, home, [sx, sz]);
      a.leader = leader;
    }
  }

  // --- Mountain goats on the high slopes beyond the far shore
  const goatHome = (() => {
    const [gx, gz] = findSpot((x, z, h) => h > 3.5 && h < 15, { x0: -50, x1: 50, z0: -110, z1: -78 }, [10, -90]);
    return { x: gx, z: gz, r: 10 };
  })();
  const goatCount = opts.isSoftwareGl ? 2 : 4;
  let goatLeader: QuadAnimal | null = null;
  for (let i = 0; i < goatCount; i++) {
    const [sx, sz] = findSpot((x, z, h) => h > 3.2 && h < 16 && Math.hypot(x - goatHome.x, z - goatHome.z) < 7, { x0: goatHome.x - 7, x1: goatHome.x + 7, z0: goatHome.z - 7, z1: goatHome.z + 7 }, [goatHome.x, goatHome.z]);
    const a = addQuad({ ...GOAT_SPEC, scale: i === goatCount - 1 ? 0.6 : 1.1 }, goatHome, [sx, sz]);
    if (!goatLeader) goatLeader = a;
    else a.leader = goatLeader;
  }

  // --- Brown bear strolling the far shore
  if (!opts.isSoftwareGl) {
    const [bx, bz] = findSpot((x, z, h) => h > 0.7 && h < 3.2 && farOk(x, z), { x0: -12, x1: 12, z0: -82, z1: -60 }, [4, -70]);
    addQuad({ ...BEAR_SPEC, scale: 1.1 }, { x: bx, z: bz, r: 12 }, [bx, bz]);
  }

  // --- Grey herons wading in the shallows
  const heronCount = opts.isSoftwareGl ? 1 : 2;
  for (let i = 0; i < heronCount; i++) {
    const region = i === 0 ? { x0: -52, x1: -30, z0: -50, z1: -12 } : { x0: 26, x1: 52, z0: -60, z1: -14 };
    const [hx, hz] = findSpot((x, z, h) => h > -0.4 && h < -0.15, region, [i === 0 ? -40 : 40, -28]);
    const h = new Heron(animalMat, geos, [hx, hz], ctx, rnd);
    herons.push(h);
    waterLife.push(h.root);
    group.add(h.root);
  }

  // --- Mallards drifting along the far reeds
  const duckCount = opts.isSoftwareGl ? 3 : 7;
  const duckHome = (() => {
    const [dx, dz] = findSpot((x, z, h) => h < -1.0 && z < -40 && farOk(x, z), { x0: -30, x1: 30, z0: -64, z1: -44 }, [-10, -52]);
    return { x: dx, z: dz, r: 8 };
  })();
  let duckLead: Duck | null = null;
  for (let i = 0; i < duckCount; i++) {
    const male = i % 3 !== 2;
    const [sx, sz] = findSpot((x, z, h) => h < -0.9 && Math.hypot(x - duckHome.x, z - duckHome.z) < 4, { x0: duckHome.x - 4, x1: duckHome.x + 4, z0: duckHome.z - 4, z1: duckHome.z + 4 }, [duckHome.x, duckHome.z]);
    const d = new Duck(animalMat, geos, male, duckHome, [sx, sz], ctx, rnd);
    if (!duckLead) duckLead = d;
    else d.leader = duckLead;
    ducks.push(d);
    waterLife.push(d.root);
    group.add(d.root);
  }

  // --- Pond turtles near the dock (visible through the clear water)
  const shellTex = createShellTexture();
  textures.push(shellTex);
  const shellMat = new THREE.MeshStandardMaterial({ map: shellTex, roughness: 0.55, metalness: 0.05 });
  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  mats.push(shellMat, skinMat);
  const turtleCount = opts.isSoftwareGl ? 1 : 3;
  for (let i = 0; i < turtleCount; i++) {
    const [tx, tz] = findSpot((x, z, h) => h < -1.0 && h > -3 && z < -4 && z > -22 && Math.abs(x) < 22, { x0: -20, x1: 20, z0: -20, z1: -5 }, [-8 + i * 7, -10]);
    const t = new Turtle(shellMat, skinMat, geos, [tx, tz], ctx, rnd, 1.0 + i * 0.15);
    t.root.userData.keepAlways = true;
    turtles.push(t);
    waterLife.push(t.root);
    group.add(t.root);
  }

  let landVisible = true;

  return {
    group,
    update: (dt, elapsed, nightFactor, weather) => {
      const dtc = Math.min(dt, 0.05);
      const stormy = weather === 'storm';
      const wantLand = nightFactor < 0.82 && !stormy;
      if (wantLand !== landVisible) {
        landVisible = wantLand;
        for (const o of land) o.visible = wantLand;
        for (const o of waterLife) {
          if (!(o.userData.keepAlways ?? false)) o.visible = wantLand || o.userData.nocturnal === true;
        }
      }
      if (landVisible) {
        for (const q of quads) q.update(dtc, elapsed);
        for (const h of herons) h.update(dtc, elapsed);
        for (const d of ducks) d.update(dtc, elapsed);
      }
      // Turtles live underwater, so they keep moving even after dark
      for (const t of turtles) t.update(dtc, elapsed);
    },
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const tx of textures) tx.dispose();
    },
  };
}
