import * as THREE from 'three';
import { groundHeightAt } from './environment';
import type { ProceduralTextureSet } from './textures';

export interface RockCollider {
  x: number;
  z: number;
  radius: number;
  topY: number;
}

export interface LakeRocksSystem {
  group: THREE.Group;
  update: (elapsed: number, coldSnowFactor: number) => void;
  dispose: () => void;
}

interface ArchSpec {
  cx: number;
  cz: number;
  dirX: number;
  dirZ: number;
  halfSpan: number;
  height: number;
  pillarRadius: number;
}

const ARCH_SPECS: ArchSpec[] = [
  // 1. Western Winding Gorge Natural Stone Arch
  { cx: -109, cz: -43, dirX: -28, dirZ: -18, halfSpan: 6.4, height: 6.4, pillarRadius: 2.25 },
  // 2. Northern Serpentine Canyon Arch
  { cx: -3, cz: -130, dirX: -38, dirZ: -24, halfSpan: 6.6, height: 6.8, pillarRadius: 2.25 },
  // 3. Eastern Rocky Reef Arch
  { cx: 125, cz: -81, dirX: -18, dirZ: -34, halfSpan: 6.4, height: 6.5, pillarRadius: 2.25 },
];

interface StackSpec {
  x: number;
  z: number;
  radius: number;
  height: number;
  hasMoss: boolean;
  seed: number;
}

const STACK_SPECS: StackSpec[] = [
  // Rocky islets sitting atop the 6 terrain island mounds (dramatic visual landmarks)
  { x: -42, z: -24, radius: 3.1, height: 4.8, hasMoss: true, seed: 1.1 },
  { x: 46, z: -28, radius: 3.3, height: 5.2, hasMoss: true, seed: 2.3 },
  { x: 38, z: -74, radius: 3.0, height: 5.5, hasMoss: true, seed: 3.7 },
  { x: -143, z: -104, radius: 3.1, height: 5.6, hasMoss: true, seed: 4.9 },
  { x: 11, z: -175, radius: 3.2, height: 6.2, hasMoss: true, seed: 5.4 },
  { x: 139, z: -124, radius: 3.1, height: 5.7, hasMoss: true, seed: 6.8 },

  // Main lake outer slalom crags (clear of dock & anchor spots)
  { x: -54, z: -52, radius: 2.1, height: 3.8, hasMoss: true, seed: 7.2 },
  { x: 56, z: -42, radius: 2.1, height: 4.1, hasMoss: true, seed: 8.5 },
  { x: 24, z: -76, radius: 2.0, height: 3.6, hasMoss: true, seed: 9.1 },

  // Western Winding Gorge slalom reefs & spires
  { x: -76, z: -30, radius: 2.05, height: 4.4, hasMoss: true, seed: 10.3 },
  { x: -119, z: -68, radius: 2.15, height: 4.9, hasMoss: true, seed: 11.7 },
  { x: -134, z: -124, radius: 2.25, height: 5.4, hasMoss: false, seed: 12.4 },
  { x: -54, z: -150, radius: 2.0, height: 4.6, hasMoss: true, seed: 13.8 },

  // Northern Serpentine Canyon spires
  { x: 9, z: -104, radius: 2.05, height: 4.7, hasMoss: true, seed: 14.2 },
  { x: -14, z: -153, radius: 2.15, height: 5.1, hasMoss: false, seed: 15.6 },
  { x: 34, z: -173, radius: 2.1, height: 5.3, hasMoss: true, seed: 16.9 },

  // Eastern Reef Labyrinth rocks
  { x: 78, z: -44, radius: 2.05, height: 4.3, hasMoss: true, seed: 17.5 },
  { x: 122, z: -55, radius: 2.15, height: 4.8, hasMoss: false, seed: 18.1 },
  { x: 128, z: -113, radius: 2.2, height: 5.0, hasMoss: true, seed: 19.4 },
  { x: 86, z: -157, radius: 2.0, height: 4.5, hasMoss: true, seed: 20.7 },
];

function buildRockColliders(): RockCollider[] {
  const list: RockCollider[] = [];
  for (const s of STACK_SPECS) {
    list.push({
      x: s.x,
      z: s.z,
      radius: s.radius + 0.35,
      topY: s.height,
    });
  }
  for (const arch of ARCH_SPECS) {
    const len = Math.hypot(arch.dirX, arch.dirZ) || 1;
    const fx = arch.dirX / len;
    const fz = arch.dirZ / len;
    // Perpendicular vector
    const px = -fz;
    const pz = fx;
    for (const side of [-1, 1]) {
      list.push({
        x: arch.cx + px * arch.halfSpan * side,
        z: arch.cz + pz * arch.halfSpan * side,
        radius: arch.pillarRadius,
        topY: arch.height,
      });
    }
  }
  return list;
}

export const ROCK_COLLIDERS: RockCollider[] = buildRockColliders();

export function isClearOfLakeRocks(x: number, z: number, clearanceRadius = 1.2): boolean {
  for (let i = 0; i < ROCK_COLLIDERS.length; i++) {
    const c = ROCK_COLLIDERS[i];
    const minDist = c.radius + clearanceRadius;
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < minDist * minDist) {
      return false;
    }
  }
  return true;
}

export function resolveRockCollision(
  x: number,
  z: number,
  hullRadius: number,
  outPush: { x: number; z: number },
): boolean {
  let hit = false;
  let px = 0;
  let pz = 0;
  for (let i = 0; i < ROCK_COLLIDERS.length; i++) {
    const c = ROCK_COLLIDERS[i];
    const minDist = c.radius + hullRadius;
    const dx = x - c.x;
    const dz = z - c.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist) {
      hit = true;
      const dist = Math.sqrt(distSq);
      const nx = dist > 0.001 ? dx / dist : 1;
      const nz = dist > 0.001 ? dz / dist : 0;
      const overlap = minDist - dist;
      px += nx * overlap;
      pz += nz * overlap;
    }
  }
  outPush.x = px;
  outPush.z = pz;
  return hit;
}

/**
 * Returns 0..1 proximity to nearby rock crags or narrow canyon walls for acoustic resonance.
 */
export function getNearestRockProximity(x: number, z: number): number {
  let best = 0;
  for (let i = 0; i < ROCK_COLLIDERS.length; i++) {
    const c = ROCK_COLLIDERS[i];
    const d = Math.hypot(x - c.x, z - c.z) - c.radius;
    if (d < 16) {
      const p = THREE.MathUtils.clamp(1 - d / 16, 0, 1);
      if (p > best) best = p;
    }
  }
  // Also boost inside the outer gorges/canyons (high canyon walls on both sides)
  if (x < -82 || x > 82 || z < -95) {
    best = Math.max(best, 0.45);
  }
  return best;
}

function hashRock(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function createSculptedRockGeo(detail: number, seedOffset: number): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(1.0, detail);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const strata = Math.sin(vy * 4.5 + seedOffset) * 0.08;
    const crag = 0.78 + hashRock(vx * 3.1 + vy * 2.2 + seedOffset, vz * 3.7 - seedOffset) * 0.36;
    pos.setXYZ(i, vx * (crag + strata), vy * (0.85 + crag * 0.25), vz * (crag - strata * 0.5));
  }
  geo.computeVertexNormals();
  return geo;
}

export function createLakeRocksSystem(textures: ProceduralTextureSet): LakeRocksSystem {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  const frostUniform = { value: 0 };

  function applyRockFrostShader(mat: THREE.MeshStandardMaterial, strength: number): void {
    mat.customProgramCacheKey = () => `lake_rock_frost_${strength.toFixed(2)}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRockFrost = frostUniform;
      shader.uniforms.uStrength = { value: strength };
      shader.vertexShader =
        `varying vec3 vRockWorldPos;\nvarying vec3 vRockWorldNorm;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vRockWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vRockWorldNorm = normalize(mat3(modelMatrix) * normal);`,
        );
      shader.fragmentShader =
        `uniform float uRockFrost;\nuniform float uStrength;\nvarying vec3 vRockWorldPos;\nvarying vec3 vRockWorldNorm;\n` +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             float wetLine = 1.0 - smoothstep(0.0, 0.65, max(0.0, vRockWorldPos.y));
             if (vRockWorldPos.y < 0.72) {
               diffuseColor.rgb *= mix(1.0, 0.54, wetLine);
             }
             float topSnow = smoothstep(0.32, 0.85, vRockWorldNorm.y) * smoothstep(0.35, 1.4, vRockWorldPos.y);
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.94, 0.98), topSnow * uRockFrost * uStrength);`,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
             float wetBand = 1.0 - smoothstep(0.0, 0.68, max(0.0, vRockWorldPos.y));
             roughnessFactor = mix(roughnessFactor, 0.24, wetBand);`,
          );
    };
  }

  const graniteMat = new THREE.MeshStandardMaterial({
    map: textures.lakebedMap,
    bumpMap: textures.terrainBumpMap,
    bumpScale: 0.08,
    color: 0x6f7479,
    roughness: 0.88,
    metalness: 0.05,
  });
  const slateMat = new THREE.MeshStandardMaterial({
    map: textures.lakebedMap,
    bumpMap: textures.terrainBumpMap,
    bumpScale: 0.09,
    color: 0x525860,
    roughness: 0.84,
    metalness: 0.07,
  });
  const mossCapMat = new THREE.MeshStandardMaterial({
    bumpMap: textures.terrainBumpMap,
    bumpScale: 0.04,
    color: 0x3b6334,
    roughness: 0.94,
    metalness: 0.01,
  });
  const foamRingMat = new THREE.MeshBasicMaterial({
    color: 0xdff4ff,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  applyRockFrostShader(graniteMat, 0.82);
  applyRockFrostShader(slateMat, 0.78);
  applyRockFrostShader(mossCapMat, 0.9);

  const rockGeoA = createSculptedRockGeo(1, 0.5);
  const rockGeoB = createSculptedRockGeo(1, 2.7);
  const spireGeo = createSculptedRockGeo(2, 4.3);
  const mossGeo = new THREE.DodecahedronGeometry(0.95, 1);
  const foamRingGeo = new THREE.RingGeometry(0.92, 1.18, 22);
  foamRingGeo.rotateX(-Math.PI / 2);

  disposables.push(
    graniteMat,
    slateMat,
    mossCapMat,
    foamRingMat,
    rockGeoA,
    rockGeoB,
    spireGeo,
    mossGeo,
    foamRingGeo,
  );

  const foamRings: { mesh: THREE.Mesh; baseScale: number; phase: number }[] = [];

  // 1. Build Composite Sea-Stacks, Reefs & Rocky Islet Outcrops
  for (let i = 0; i < STACK_SPECS.length; i++) {
    const spec = STACK_SPECS[i];
    const bedY = groundHeightAt(spec.x, spec.z);
    const root = new THREE.Group();
    root.position.set(spec.x, 0, spec.z);

    // Base plinth anchored firmly into the lakebed
    const baseDepth = Math.max(0.8, -bedY + 0.45);
    const baseB = new THREE.Mesh(i % 2 === 0 ? rockGeoA : rockGeoB, slateMat);
    baseB.position.set(0, Math.min(-0.2, bedY * 0.4), 0);
    baseB.scale.set(spec.radius * 0.96, baseDepth * 0.55 + 0.9, spec.radius * 0.9);
    baseB.rotation.y = spec.seed * 1.4;
    baseB.castShadow = true;
    baseB.receiveShadow = true;
    root.add(baseB);

    // Main towering crag spire
    const mainSpire = new THREE.Mesh(spireGeo, graniteMat);
    mainSpire.position.set(0, spec.height * 0.36, 0);
    mainSpire.scale.set(spec.radius * 0.62, spec.height * 0.55, spec.radius * 0.58);
    mainSpire.rotation.set((hashRock(spec.seed, 1) - 0.5) * 0.25, spec.seed * 2.1, (hashRock(spec.seed, 2) - 0.5) * 0.22);
    mainSpire.castShadow = true;
    mainSpire.receiveShadow = true;
    root.add(mainSpire);

    // 2–3 Shoulder boulders breaking up the silhouette
    const shoulderCount = 3;
    for (let b = 0; b < shoulderCount; b++) {
      const ang = spec.seed + (b / shoulderCount) * Math.PI * 2 + 0.4;
      const dist = spec.radius * (0.48 + hashRock(spec.seed, b + 4) * 0.22);
      const sb = new THREE.Mesh(b % 2 === 0 ? rockGeoB : rockGeoA, b === 1 ? graniteMat : slateMat);
      const shH = spec.height * (0.28 + hashRock(b, spec.seed) * 0.22);
      sb.position.set(Math.cos(ang) * dist, shH * 0.35 - 0.15, Math.sin(ang) * dist);
      sb.scale.set(spec.radius * 0.42, shH * 0.52, spec.radius * 0.38);
      sb.rotation.set(b * 0.4, ang, b * 0.3);
      sb.castShadow = true;
      sb.receiveShadow = true;
      root.add(sb);
    }

    // Lush mossy cap perched on natural ledges
    if (spec.hasMoss) {
      const moss = new THREE.Mesh(mossGeo, mossCapMat);
      moss.position.set(0.15, spec.height * 0.72, -0.1);
      moss.scale.set(spec.radius * 0.42, 0.28, spec.radius * 0.38);
      moss.receiveShadow = true;
      root.add(moss);
    }

    // Waterline subtle foam collar
    const foam = new THREE.Mesh(foamRingGeo, foamRingMat);
    foam.position.set(0, 0.025, 0);
    const fScale = spec.radius * 1.02;
    foam.scale.setScalar(fScale);
    root.add(foam);
    foamRings.push({ mesh: foam, baseScale: fScale, phase: spec.seed });

    group.add(root);
  }

  // 2. Build 3 Monumental Natural Stone Archways Spanning Navigable Channels
  for (let a = 0; a < ARCH_SPECS.length; a++) {
    const arch = ARCH_SPECS[a];
    const len = Math.hypot(arch.dirX, arch.dirZ) || 1;
    const fx = arch.dirX / len;
    const fz = arch.dirZ / len;
    const yaw = Math.atan2(fx, fz);

    const archGroup = new THREE.Group();
    archGroup.position.set(arch.cx, 0, arch.cz);
    archGroup.rotation.y = yaw;

    // Two heavy rock pillars on left (-X) and right (+X) leaving center clear for the boat!
    for (const side of [-1, 1]) {
      const px = side * arch.halfSpan;
      const bedY = groundHeightAt(arch.cx - fz * px, arch.cz + fx * px);
      const baseH = Math.max(2.0, -bedY + 1.0);

      const foot = new THREE.Mesh(rockGeoA, slateMat);
      foot.position.set(px, -baseH * 0.25 + 0.4, 0);
      foot.scale.set(arch.pillarRadius * 1.05, baseH * 0.55 + 1.2, arch.pillarRadius * 1.15);
      foot.rotation.y = side * 0.7 + a;
      foot.castShadow = true;
      foot.receiveShadow = true;
      archGroup.add(foot);

      const col = new THREE.Mesh(spireGeo, graniteMat);
      col.position.set(px * 0.96, arch.height * 0.45, 0);
      col.scale.set(arch.pillarRadius * 0.78, arch.height * 0.52, arch.pillarRadius * 0.85);
      col.rotation.z = side * 0.14;
      col.castShadow = true;
      col.receiveShadow = true;
      archGroup.add(col);

      const foam = new THREE.Mesh(foamRingGeo, foamRingMat);
      foam.position.set(px, 0.025, 0);
      const fScale = arch.pillarRadius * 1.08;
      foam.scale.setScalar(fScale);
      archGroup.add(foam);
      foamRings.push({ mesh: foam, baseScale: fScale, phase: a * 2.1 + side });
    }

    // Overhead stone bridge blocks forming the natural arch keystone span
    const spanSegments = 5;
    for (let s = 0; s < spanSegments; s++) {
      const t = s / (spanSegments - 1); // 0..1 from left to right
      const sx = THREE.MathUtils.lerp(-arch.halfSpan * 0.84, arch.halfSpan * 0.84, t);
      const archCurveY = Math.sin(t * Math.PI) * 1.45;
      const sy = arch.height * 0.86 + archCurveY;
      const block = new THREE.Mesh(s % 2 === 0 ? rockGeoB : rockGeoA, s === 2 ? graniteMat : slateMat);
      block.position.set(sx, sy, (s % 2 === 0 ? 0.15 : -0.15));
      block.scale.set(2.35, 1.35 + Math.sin(t * Math.PI) * 0.35, 1.85);
      block.rotation.set(s * 0.3, s * 0.8, (t - 0.5) * -0.45);
      block.castShadow = true;
      block.receiveShadow = true;
      archGroup.add(block);
    }

    // Hanging moss garlands along the top keystone
    for (const mx of [-2.4, 0, 2.5]) {
      const moss = new THREE.Mesh(mossGeo, mossCapMat);
      moss.position.set(mx, arch.height + 0.82 - Math.abs(mx) * 0.12, 0.35);
      moss.scale.set(1.35, 0.34, 1.1);
      archGroup.add(moss);
    }

    group.add(archGroup);
  }

  return {
    group,
    update: (elapsed, coldSnowFactor) => {
      frostUniform.value = THREE.MathUtils.lerp(frostUniform.value, THREE.MathUtils.clamp(coldSnowFactor, 0, 1), 0.05);
      for (let i = 0; i < foamRings.length; i++) {
        const fr = foamRings[i];
        const pulse = 1.0 + Math.sin(elapsed * 1.9 + fr.phase) * 0.045;
        fr.mesh.scale.setScalar(fr.baseScale * pulse);
      }
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
