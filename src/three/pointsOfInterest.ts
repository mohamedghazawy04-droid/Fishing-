import * as THREE from 'three';
import { groundHeightAt } from './environment';
import type { ProceduralTextureSet } from './textures';
import { LAKE_POI_CATALOG, type LakePoiDefinition, type PoiId } from '../types/fishing';

export interface PoiInstanceInfo {
  definition: LakePoiDefinition;
  worldX: number;
  worldZ: number;
  approachX: number;
  approachZ: number;
  discovered: boolean;
}

export interface PointsOfInterestSystem {
  group: THREE.Group;
  setDiscoveredIds: (ids: PoiId[]) => void;
  getPoiInfos: () => PoiInstanceInfo[];
  getPoiApproach: (id: PoiId) => { x: number; z: number } | null;
  update: (params: {
    dt: number;
    elapsed: number;
    nightFactor: number;
    coldSnowFactor: number;
    boatPos: THREE.Vector3;
    isOnBoat: boolean;
    onRipple: (x: number, z: number, strength: number) => void;
  }) => { newlyDiscoveredId: PoiId | null; nearbyUndiscoveredId: PoiId | null; nearbyDistance: number };
  dispose: () => void;
}

interface InternalPoiNode {
  def: LakePoiDefinition;
  root: THREE.Group;
  worldX: number;
  worldZ: number;
  approachX: number;
  approachZ: number;
  discovered: boolean;
  beaconGroup: THREE.Group;
  beaconMotes: THREE.Mesh[];
  lanternLights: THREE.PointLight[];
  swayPart?: THREE.Object3D;
  waterfallPlanes?: THREE.Mesh[];
  waterfallRippleTimer: number;
}

function findPointAlongLakeRay(
  dirX: number,
  dirZ: number,
  targetGroundY: number,
  startRadius = 26,
  maxRadius = 98,
): { x: number; z: number; y: number } {
  const len = Math.hypot(dirX, dirZ) || 1;
  const nx = dirX / len;
  const nz = dirZ / len;
  const cx = 0;
  const cz = -44;

  for (let r = startRadius; r <= maxRadius; r += 0.5) {
    const px = cx + nx * r;
    const pz = cz + nz * r;
    const py = groundHeightAt(px, pz);
    if (py >= targetGroundY) {
      return { x: px, z: pz, y: py };
    }
  }
  const fx = cx + nx * 72;
  const fz = cz + nz * 72;
  return { x: fx, z: fz, y: groundHeightAt(fx, fz) };
}

function findSafeBoatApproach(
  worldX: number,
  worldZ: number,
  standoffMeters = 8.2,
): { x: number; z: number } {
  const toCenterX = 0 - worldX;
  const toCenterZ = -44 - worldZ;
  const len = Math.hypot(toCenterX, toCenterZ) || 1;
  const ux = toCenterX / len;
  const uz = toCenterZ / len;

  for (let d = standoffMeters; d <= 22; d += 1.0) {
    const ax = worldX + ux * d;
    const az = worldZ + uz * d;
    if (groundHeightAt(ax, az) <= -0.82) {
      return { x: ax, z: az };
    }
  }
  return { x: worldX + ux * 12, z: worldZ + uz * 12 };
}

export function createPointsOfInterest(textures: ProceduralTextureSet): PointsOfInterestSystem {
  const group = new THREE.Group();
  const sharedGeos: THREE.BufferGeometry[] = [];
  const sharedMats: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    sharedGeos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    sharedMats.push(m);
    return m;
  };

  // Shared PBR materials with distinct roughness / metalness contrast
  const oldWoodMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.woodPlankMap,
      bumpMap: textures.woodBumpMap,
      bumpScale: 0.018,
      color: 0x5c4632,
      roughness: 0.92,
      metalness: 0.03,
    }),
  );
  const darkTimberMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.barkMap,
      color: 0x3b2c1f,
      roughness: 0.94,
      metalness: 0.02,
    }),
  );
  const mossMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3d5c33,
      roughness: 0.96,
      metalness: 0.0,
    }),
  );
  const graniteRockMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.lakebedMap,
      bumpMap: textures.terrainBumpMap,
      bumpScale: 0.04,
      color: 0x767b7f,
      roughness: 0.9,
      metalness: 0.04,
    }),
  );
  const caveDarkMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x15191d,
      roughness: 0.98,
      metalness: 0.02,
    }),
  );
  const rustyIronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x4b352a,
      roughness: 0.56,
      metalness: 0.72,
    }),
  );
  const agedBronzeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x8f7443,
      roughness: 0.34,
      metalness: 0.84,
    }),
  );
  const ropeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xa6926c,
      roughness: 0.95,
    }),
  );
  const tatteredClothMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd1c5ad,
      roughness: 0.92,
      side: THREE.DoubleSide,
    }),
  );
  const warmAmberGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffd185,
      emissive: 0xff9e38,
      emissiveIntensity: 1.4,
      roughness: 0.25,
    }),
  );
  const crystalGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.35,
      roughness: 0.16,
      metalness: 0.25,
    }),
  );
  const waterfallMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xbdeafe,
      emissive: 0x1d4d63,
      emissiveIntensity: 0.35,
      roughness: 0.12,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
    }),
  );
  const beaconMoteMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    }),
  );
  const discoveredMoteMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x6ee7b7,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  );

  const moteGeo = trackGeo(new THREE.SphereGeometry(0.11, 8, 8));

  function createDiscoveryBeacon(baseY: number): { beaconGroup: THREE.Group; motes: THREE.Mesh[] } {
    const beaconGroup = new THREE.Group();
    beaconGroup.position.y = baseY;
    const motes: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(moteGeo, beaconMoteMat);
      beaconGroup.add(m);
      motes.push(m);
    }
    return { beaconGroup, motes };
  }

  const defMap = new Map(LAKE_POI_CATALOG.map((d) => [d.id, d]));
  const poiNodes: InternalPoiNode[] = [];

  // ---------------------------------------------------------------------------
  // 1. Old Weathered Wooden Pier (Western Cove)
  // ---------------------------------------------------------------------------
  {
    const def = defMap.get('old_pier')!;
    const spot = findPointAlongLakeRay(-0.92, 0.34, -0.04, 34, 96);
    const approach = findSafeBoatApproach(spot.x, spot.z, 8.8);
    const root = new THREE.Group();
    root.position.set(spot.x, 0, spot.z);
    // Point pier outward into lake center (0, -44)
    const yaw = Math.atan2(0 - spot.x, -44 - spot.z);
    root.rotation.y = yaw;

    const postGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 2.2, 8));
    const mossCollarGeo = trackGeo(new THREE.CylinderGeometry(0.145, 0.155, 0.32, 8));
    const beamGeo = trackGeo(new THREE.BoxGeometry(2.15, 0.12, 0.14));
    const plankGeo = trackGeo(new THREE.BoxGeometry(2.2, 0.07, 0.32));

    // Leaning pilings along z = 0..5.0 (local +Z extends toward lake)
    for (let row = 0; row < 4; row++) {
      const pz = row * 1.65;
      for (const side of [-0.88, 0.88]) {
        const piling = new THREE.Mesh(postGeo, darkTimberMat);
        piling.position.set(side, 0.1, pz);
        piling.rotation.z = (row === 3 ? 0.08 : 0.04) * (side > 0 ? 1 : -1);
        piling.rotation.x = row === 2 ? -0.05 : 0.02;
        piling.castShadow = true;
        piling.receiveShadow = true;
        root.add(piling);

        const collar = new THREE.Mesh(mossCollarGeo, mossMat);
        collar.position.set(side, 0.02, pz);
        root.add(collar);
      }
      const cross = new THREE.Mesh(beamGeo, darkTimberMat);
      cross.position.set(0, 0.52 - row * 0.03, pz);
      cross.rotation.z = row === 3 ? 0.06 : (row % 2 === 0 ? -0.02 : 0.025);
      cross.castShadow = true;
      root.add(cross);
    }

    // Weathered planks (skip one plank to look abandoned & authentic)
    for (let i = 0; i < 14; i++) {
      if (i === 9 || i === 12) continue;
      const pz = -0.3 + i * 0.39;
      const sag = Math.sin((i / 14) * Math.PI) * 0.04;
      const plank = new THREE.Mesh(plankGeo, oldWoodMat);
      plank.position.set((i % 3 === 0 ? 0.05 : -0.03), 0.60 - sag - i * 0.01, pz);
      plank.rotation.y = (i % 4 - 1.5) * 0.035;
      plank.rotation.z = i > 10 ? 0.06 : 0;
      plank.castShadow = true;
      plank.receiveShadow = true;
      root.add(plank);
    }

    // Leaning lantern post & rusty amber lantern at pier tip
    const lPostGeo = trackGeo(new THREE.CylinderGeometry(0.055, 0.075, 2.35, 7));
    const lArmGeo = trackGeo(new THREE.BoxGeometry(0.55, 0.06, 0.06));
    const lBodyGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 0.24, 6));
    const lPost = new THREE.Mesh(lPostGeo, darkTimberMat);
    lPost.position.set(0.92, 1.25, 4.75);
    lPost.rotation.z = -0.08;
    lPost.castShadow = true;
    const lArm = new THREE.Mesh(lArmGeo, rustyIronMat);
    lArm.position.set(0.70, 2.30, 4.75);
    const lanternHousing = new THREE.Mesh(lBodyGeo, rustyIronMat);
    lanternHousing.position.set(0.48, 2.08, 4.75);
    const lanternCore = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.07, 8, 8)), warmAmberGlowMat);
    lanternCore.position.set(0.48, 2.06, 4.75);
    const pierLight = new THREE.PointLight(0xffa447, 0.8, 14, 1.8);
    pierLight.position.set(0.48, 2.02, 4.75);
    root.add(lPost, lArm, lanternHousing, lanternCore, pierLight);

    // Mooring bollard + coiled rope + tilted old wooden crate
    const bollard = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.12, 0.14, 0.65, 8)), darkTimberMat);
    bollard.position.set(-0.85, 0.82, 4.65);
    const ropeCoil = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.18, 0.035, 6, 14)), ropeMat);
    ropeCoil.rotation.x = Math.PI / 2;
    ropeCoil.position.set(-0.85, 0.62, 4.65);
    const crate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.56, 0.44, 0.48)), oldWoodMat);
    crate.position.set(-0.42, 0.78, 2.35);
    crate.rotation.set(0.06, 0.42, -0.08);
    crate.castShadow = true;
    root.add(bollard, ropeCoil, crate);

    const { beaconGroup, motes } = createDiscoveryBeacon(2.7);
    beaconGroup.position.set(0, 2.7, 3.6);
    root.add(beaconGroup);

    group.add(root);
    poiNodes.push({
      def,
      root,
      worldX: spot.x,
      worldZ: spot.z,
      approachX: approach.x,
      approachZ: approach.z,
      discovered: false,
      beaconGroup,
      beaconMotes: motes,
      lanternLights: [pierLight],
      waterfallRippleTimer: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Hidden Cliff Cave & Waterfall Grotto (North-West Rocky Bank)
  // ---------------------------------------------------------------------------
  {
    const def = defMap.get('hidden_cave')!;
    const spot = findPointAlongLakeRay(-0.48, -0.88, 0.35, 36, 98);
    const approach = findSafeBoatApproach(spot.x, spot.z, 9.5);
    const root = new THREE.Group();
    root.position.set(spot.x, spot.y - 0.3, spot.z);
    const yaw = Math.atan2(0 - spot.x, -44 - spot.z);
    root.rotation.y = yaw;

    // Cliffside stone arch & rock mound framing the dark cave mouth
    const rockGeo = trackGeo(new THREE.DodecahedronGeometry(1.0, 1));
    const archParts: [number, number, number, number, number, number][] = [
      [-2.35, 1.3, 0.0, 1.9, 2.4, 1.8],
      [2.35, 1.3, 0.0, 1.9, 2.4, 1.8],
      [-1.4, 3.1, -0.2, 1.8, 1.5, 1.9],
      [1.4, 3.1, -0.2, 1.8, 1.5, 1.9],
      [0.0, 3.7, -0.5, 2.4, 1.4, 2.1],
      [-2.9, 0.5, 0.9, 1.4, 1.1, 1.2],
      [2.9, 0.6, 0.8, 1.5, 1.2, 1.3],
      [0.0, 2.3, -2.5, 3.4, 3.0, 1.8],
    ];
    archParts.forEach(([x, y, z, sx, sy, sz], idx) => {
      const boulder = new THREE.Mesh(rockGeo, idx % 2 === 0 ? graniteRockMat : oldWoodMat);
      if (idx % 2 === 1) boulder.material = graniteRockMat;
      boulder.position.set(x, y, z);
      boulder.scale.set(sx, sy, sz);
      boulder.rotation.set(idx * 0.4, idx * 0.8, idx * 0.25);
      boulder.castShadow = true;
      boulder.receiveShadow = true;
      root.add(boulder);
    });

    // Dark recessed cave chamber interior
    const chamber = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.9, 2.1, 3.2, 10, 1, false, 0, Math.PI)), caveDarkMat);
    chamber.rotation.z = Math.PI / 2;
    chamber.rotation.y = Math.PI / 2;
    chamber.position.set(0, 1.4, -0.8);
    root.add(chamber);

    const caveBackWall = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(2.15, 10, 8)), caveDarkMat);
    caveBackWall.scale.set(1.2, 1.15, 0.8);
    caveBackWall.position.set(0, 1.45, -1.65);
    root.add(caveBackWall);

    // Stalactites & Moss clusters at cave lip
    const stalGeo = trackGeo(new THREE.ConeGeometry(0.14, 0.72, 6));
    stalGeo.rotateX(Math.PI);
    for (const [sx, sy, sz] of [[-0.85, 2.75, 0.45], [-0.15, 2.95, 0.55], [0.65, 2.82, 0.42]]) {
      const st = new THREE.Mesh(stalGeo, graniteRockMat);
      st.position.set(sx, sy, sz);
      root.add(st);
    }

    const mossPadGeo = trackGeo(new THREE.SphereGeometry(0.55, 7, 6));
    for (const [mx, my, mz] of [[-1.6, 2.5, 1.1], [1.5, 2.4, 1.05], [-0.2, 3.45, 0.9]]) {
      const mp = new THREE.Mesh(mossPadGeo, mossMat);
      mp.position.set(mx, my, mz);
      mp.scale.set(1.3, 0.45, 0.8);
      root.add(mp);
    }

    // Glowing mineral crystals inside the cave + explorer lantern
    const crystalGeo = trackGeo(new THREE.ConeGeometry(0.18, 0.88, 5));
    for (const [cx, cy, cz, rotZ] of [
      [-0.75, 0.85, -0.4, 0.25],
      [-0.55, 0.75, -0.25, -0.18],
      [0.72, 0.92, -0.55, -0.28],
      [0.05, 1.15, -0.85, 0.12],
    ]) {
      const cr = new THREE.Mesh(crystalGeo, crystalGlowMat);
      cr.position.set(cx, cy, cz);
      cr.rotation.z = rotZ;
      root.add(cr);
    }

    const caveLight = new THREE.PointLight(0x4fd1f5, 1.8, 16, 1.6);
    caveLight.position.set(0, 1.45, 0.15);
    root.add(caveLight);

    // Cascading side waterfall ribbons splashing into the cove
    const waterfallGeo = trackGeo(new THREE.PlaneGeometry(1.15, 3.4, 4, 8));
    const waterfallPlanes: THREE.Mesh[] = [];
    for (let w = 0; w < 2; w++) {
      const wf = new THREE.Mesh(waterfallGeo, waterfallMat);
      wf.position.set(2.15 + w * 0.18, 1.65, 1.25 + w * 0.12);
      wf.rotation.x = -0.18;
      wf.rotation.y = 0.22;
      root.add(wf);
      waterfallPlanes.push(wf);
    }

    const { beaconGroup, motes } = createDiscoveryBeacon(4.5);
    beaconGroup.position.set(0, 4.5, 1.2);
    root.add(beaconGroup);

    group.add(root);
    poiNodes.push({
      def,
      root,
      worldX: spot.x,
      worldZ: spot.z,
      approachX: approach.x,
      approachZ: approach.z,
      discovered: false,
      beaconGroup,
      beaconMotes: motes,
      lanternLights: [caveLight],
      waterfallPlanes,
      waterfallRippleTimer: 0.4,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Sunken Stone Bell Tower Ruins (North-East Shallow Shoal)
  // ---------------------------------------------------------------------------
  {
    const def = defMap.get('sunken_bell_tower')!;
    const spot = findPointAlongLakeRay(0.52, -0.85, -1.05, 30, 92);
    const approach = findSafeBoatApproach(spot.x, spot.z, 8.6);
    const root = new THREE.Group();
    root.position.set(spot.x, 0, spot.z);
    const yaw = Math.atan2(0 - spot.x, -44 - spot.z);
    root.rotation.y = yaw;

    // Submerged plinth base resting on lakebed
    const plinth = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.8, 1.25, 2.8)), graniteRockMat);
    plinth.position.set(0, -0.85, 0);
    plinth.receiveShadow = true;
    root.add(plinth);

    // Two weathered mossy columns rising above the waterline
    const colGeo = trackGeo(new THREE.CylinderGeometry(0.28, 0.34, 3.2, 8));
    for (const sx of [-1.05, 1.05]) {
      const col = new THREE.Mesh(colGeo, graniteRockMat);
      col.position.set(sx, 1.15, 0);
      col.rotation.z = sx < 0 ? 0.04 : -0.05;
      col.castShadow = true;
      col.receiveShadow = true;
      root.add(col);

      const mossCap = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.36, 7, 6)), mossMat);
      mossCap.position.set(sx, 0.05, 0);
      mossCap.scale.set(1.1, 0.45, 1.1);
      root.add(mossCap);
    }

    // Stone lintel & weathered timber beam
    const lintel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.9, 0.42, 0.64)), graniteRockMat);
    lintel.position.set(0, 2.72, 0);
    lintel.castShadow = true;
    root.add(lintel);

    // Swaying Tarnished Bronze Bell suspended beneath the stone arch
    const bellPivot = new THREE.Group();
    bellPivot.position.set(0, 2.48, 0);
    const chain = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6)), rustyIronMat);
    chain.position.y = -0.21;
    const bellPoints = [
      new THREE.Vector2(0.02, 0.42),
      new THREE.Vector2(0.18, 0.36),
      new THREE.Vector2(0.24, 0.16),
      new THREE.Vector2(0.34, 0.0),
      new THREE.Vector2(0.28, 0.0),
    ];
    const bellGeo = trackGeo(new THREE.LatheGeometry(bellPoints, 14));
    const bellMesh = new THREE.Mesh(bellGeo, agedBronzeMat);
    bellMesh.position.y = -0.80;
    bellMesh.castShadow = true;
    const clapper = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.075, 8, 8)), rustyIronMat);
    clapper.position.y = -0.82;
    bellPivot.add(chain, bellMesh, clapper);
    root.add(bellPivot);

    // Gentle relic glow from beneath the arch at night
    const bellGlow = new THREE.PointLight(0xf6c96b, 0.65, 13, 1.8);
    bellGlow.position.set(0, 1.8, 0.25);
    root.add(bellGlow);

    const { beaconGroup, motes } = createDiscoveryBeacon(3.6);
    root.add(beaconGroup);

    group.add(root);
    poiNodes.push({
      def,
      root,
      worldX: spot.x,
      worldZ: spot.z,
      approachX: approach.x,
      approachZ: approach.z,
      discovered: false,
      beaconGroup,
      beaconMotes: motes,
      lanternLights: [bellGlow],
      swayPart: bellPivot,
      waterfallRippleTimer: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Ancient Mountain Lantern Shrine (Eastern Tranquil Cove)
  // ---------------------------------------------------------------------------
  {
    const def = defMap.get('ancient_lantern_shrine')!;
    const spot = findPointAlongLakeRay(0.92, 0.30, 0.24, 36, 96);
    const approach = findSafeBoatApproach(spot.x, spot.z, 8.8);
    const root = new THREE.Group();
    root.position.set(spot.x, spot.y - 0.18, spot.z);
    const yaw = Math.atan2(0 - spot.x, -44 - spot.z);
    root.rotation.y = yaw;

    // Tiered stone terrace & steps reaching down toward the water
    const basePad = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.2, 0.65, 2.8)), graniteRockMat);
    basePad.position.set(0, 0.18, 0);
    basePad.receiveShadow = true;
    const step1 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.1, 0.25, 0.7)), graniteRockMat);
    step1.position.set(0, 0.05, 1.55);
    const step2 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.8, 0.22, 0.6)), graniteRockMat);
    step2.position.set(0, -0.1, 2.1);
    root.add(basePad, step1, step2);

    // Traditional carved granite pedestal lantern
    const ped = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.24, 0.34, 1.15, 6)), graniteRockMat);
    ped.position.set(0, 1.0, -0.15);
    ped.castShadow = true;
    const fireBox = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.46, 0.44, 0.46)), warmAmberGlowMat);
    fireBox.position.set(0, 1.78, -0.15);
    const roof = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.62, 0.42, 6)), graniteRockMat);
    roof.position.set(0, 2.2, -0.15);
    roof.castShadow = true;
    const shrineLight = new THREE.PointLight(0xffad4c, 1.1, 16, 1.7);
    shrineLight.position.set(0, 1.85, 0.25);
    root.add(ped, fireBox, roof, shrineLight);

    // Timber shelter arch flanking the stone lantern
    const pillarGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 2.9, 8));
    for (const sx of [-1.25, 1.25]) {
      const pil = new THREE.Mesh(pillarGeo, darkTimberMat);
      pil.position.set(sx, 1.65, 0.65);
      pil.castShadow = true;
      root.add(pil);
    }
    const topBeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.3, 0.18, 0.22)), oldWoodMat);
    topBeam.position.set(0, 3.05, 0.65);
    topBeam.castShadow = true;
    const charmRibbon = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.32, 0.52)), tatteredClothMat);
    charmRibbon.position.set(0, 2.68, 0.65);
    root.add(topBeam, charmRibbon);

    const { beaconGroup, motes } = createDiscoveryBeacon(3.65);
    root.add(beaconGroup);

    group.add(root);
    poiNodes.push({
      def,
      root,
      worldX: spot.x,
      worldZ: spot.z,
      approachX: approach.x,
      approachZ: approach.z,
      discovered: false,
      beaconGroup,
      beaconMotes: motes,
      lanternLights: [shrineLight],
      swayPart: charmRibbon,
      waterfallRippleTimer: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Wrecked Explorer's Skiff & Treasure Cove (West-North-West Shallows)
  // ---------------------------------------------------------------------------
  {
    const def = defMap.get('wrecked_skiff_cove')!;
    const spot = findPointAlongLakeRay(-0.96, -0.22, -0.28, 36, 96);
    const approach = findSafeBoatApproach(spot.x, spot.z, 8.6);
    const root = new THREE.Group();
    root.position.set(spot.x, Math.max(-0.35, spot.y), spot.z);
    const yaw = Math.atan2(0 - spot.x, -44 - spot.z) + 0.55;
    root.rotation.y = yaw;

    // Half-submerged tilted boat ribs & keel
    const wreckGroup = new THREE.Group();
    wreckGroup.rotation.set(0.14, 0.2, -0.34);
    const keel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.22, 3.6)), darkTimberMat);
    keel.position.set(0, 0.12, 0);
    wreckGroup.add(keel);

    const ribGeo = trackGeo(new THREE.TorusGeometry(0.75, 0.06, 6, 12, Math.PI));
    ribGeo.rotateZ(Math.PI);
    for (let r = 0; r < 5; r++) {
      const rib = new THREE.Mesh(ribGeo, oldWoodMat);
      rib.position.set(0, 0.62, -1.25 + r * 0.62);
      const scaleW = 0.72 + Math.sin((r / 4) * Math.PI) * 0.35;
      rib.scale.set(scaleW, 0.78, 1);
      rib.castShadow = true;
      wreckGroup.add(rib);
    }

    // Broken mast & tattered sail cloth
    const mast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.055, 0.08, 2.35, 7)), darkTimberMat);
    mast.position.set(0.05, 1.2, -0.35);
    mast.rotation.z = 0.12;
    mast.castShadow = true;
    const yard = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.032, 0.035, 1.35, 6)), oldWoodMat);
    yard.rotation.z = Math.PI / 2 - 0.18;
    yard.position.set(0.18, 1.9, -0.35);
    const sail = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(1.15, 1.05, 3, 3)), tatteredClothMat);
    sail.position.set(0.18, 1.38, -0.3);
    sail.rotation.y = 0.15;
    wreckGroup.add(mast, yard, sail);
    root.add(wreckGroup);

    // Explorer's brass-banded wooden chest resting on the shallow sandbar beside the wreck
    const chestGroup = new THREE.Group();
    chestGroup.position.set(1.45, 0.15, 0.75);
    chestGroup.rotation.set(0.05, -0.5, -0.08);
    const chestBody = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.78, 0.44, 0.52)), oldWoodMat);
    chestBody.castShadow = true;
    const chestLid = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.26, 0.26, 0.78, 10, 1, false, 0, Math.PI)),
      oldWoodMat,
    );
    chestLid.rotation.z = Math.PI / 2;
    chestLid.position.y = 0.22;
    const strapGeo = trackGeo(new THREE.BoxGeometry(0.07, 0.48, 0.55));
    for (const sx of [-0.24, 0.24]) {
      const strap = new THREE.Mesh(strapGeo, agedBronzeMat);
      strap.position.x = sx;
      chestGroup.add(strap);
    }
    const lockPlate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.12, 0.14, 0.05)), agedBronzeMat);
    lockPlate.position.set(0, 0.16, 0.27);
    const glint = new THREE.PointLight(0xf6c95b, 0.85, 12, 1.7);
    glint.position.set(0, 0.45, 0.2);
    chestGroup.add(chestBody, chestLid, lockPlate, glint);
    root.add(chestGroup);

    const { beaconGroup, motes } = createDiscoveryBeacon(2.9);
    root.add(beaconGroup);

    group.add(root);
    poiNodes.push({
      def,
      root,
      worldX: spot.x,
      worldZ: spot.z,
      approachX: approach.x,
      approachZ: approach.z,
      discovered: false,
      beaconGroup,
      beaconMotes: motes,
      lanternLights: [glint],
      swayPart: sail,
      waterfallRippleTimer: 0,
    });
  }

  function applyDiscoveredVisual(node: InternalPoiNode): void {
    const targetMat = node.discovered ? discoveredMoteMat : beaconMoteMat;
    for (const m of node.beaconMotes) {
      m.material = targetMat;
      m.scale.setScalar(node.discovered ? 0.58 : 1.0);
    }
  }

  return {
    group,
    setDiscoveredIds: (ids) => {
      const set = new Set<PoiId>(ids);
      for (const node of poiNodes) {
        node.discovered = set.has(node.def.id);
        applyDiscoveredVisual(node);
      }
    },
    getPoiInfos: () =>
      poiNodes.map((n) => ({
        definition: n.def,
        worldX: n.worldX,
        worldZ: n.worldZ,
        approachX: n.approachX,
        approachZ: n.approachZ,
        discovered: n.discovered,
      })),
    getPoiApproach: (id) => {
      const found = poiNodes.find((n) => n.def.id === id);
      return found ? { x: found.approachX, z: found.approachZ } : null;
    },
    update: ({ dt, elapsed, nightFactor, boatPos, isOnBoat, onRipple }) => {
      let newlyDiscoveredId: PoiId | null = null;
      let nearbyUndiscoveredId: PoiId | null = null;
      let nearbyDistance = 999;

      for (let i = 0; i < poiNodes.length; i++) {
        const node = poiNodes[i];

        // Orbiting discovery wisps (bright golden wisps while undiscovered, subtle emerald aura once found)
        const baseRadius = node.discovered ? 0.85 : 1.35;
        for (let m = 0; m < node.beaconMotes.length; m++) {
          const mote = node.beaconMotes[m];
          const ang = elapsed * (node.discovered ? 0.65 : 1.25) + m * ((Math.PI * 2) / 6) + i;
          mote.position.set(
            Math.cos(ang) * baseRadius,
            Math.sin(elapsed * 2.1 + m * 1.3) * 0.45,
            Math.sin(ang) * baseRadius,
          );
        }

        // Lantern & crystal glow boosts gracefully at dusk/night
        for (const l of node.lanternLights) {
          const baseInt = node.def.id === 'hidden_cave' ? 1.55 : 0.45;
          const nightBoost = node.def.id === 'hidden_cave' ? 2.4 : 2.2;
          l.intensity = THREE.MathUtils.lerp(baseInt, nightBoost, nightFactor) + Math.sin(elapsed * 3.1 + i) * 0.12;
        }

        // Swaying bell / shrine charm / tattered sail
        if (node.swayPart) {
          if (node.def.id === 'sunken_bell_tower') {
            node.swayPart.rotation.z = Math.sin(elapsed * 1.15 + i) * 0.085;
            node.swayPart.rotation.x = Math.cos(elapsed * 0.85) * 0.04;
          } else {
            node.swayPart.rotation.x = Math.sin(elapsed * 2.2 + i) * 0.11;
          }
        }

        // Hidden cave waterfall shimmer & water cove ripples
        if (node.waterfallPlanes) {
          node.waterfallPlanes.forEach((wf, wIdx) => {
            wf.position.y = 1.65 + Math.sin(elapsed * 9.0 + wIdx * 2.1) * 0.045;
          });
          node.waterfallRippleTimer -= dt;
          if (node.waterfallRippleTimer <= 0) {
            node.waterfallRippleTimer = 0.75;
            const splashX = node.worldX + Math.sin(node.root.rotation.y) * 2.6;
            const splashZ = node.worldZ + Math.cos(node.root.rotation.y) * 2.6;
            onRipple(splashX, splashZ, 0.55);
          }
        }

        // Boat exploration proximity detection
        if (isOnBoat && !node.discovered) {
          const distToLandmark = Math.hypot(boatPos.x - node.worldX, boatPos.z - node.worldZ);
          const distToApproach = Math.hypot(boatPos.x - node.approachX, boatPos.z - node.approachZ);
          const effectiveDist = Math.min(distToLandmark, distToApproach + 4.5);

          if (effectiveDist <= node.def.discoveryRadius) {
            node.discovered = true;
            applyDiscoveredVisual(node);
            newlyDiscoveredId = node.def.id;
            onRipple(boatPos.x, boatPos.z, 1.1);
          } else if (distToLandmark < 26 && distToLandmark < nearbyDistance) {
            nearbyDistance = distToLandmark;
            nearbyUndiscoveredId = node.def.id;
          }
        }
      }

      return { newlyDiscoveredId, nearbyUndiscoveredId, nearbyDistance };
    },
    dispose: () => {
      for (const g of sharedGeos) g.dispose();
      for (const m of sharedMats) m.dispose();
    },
  };
}
