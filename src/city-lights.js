import * as THREE from 'three';

// Night-only city lighting: instanced street lamps, riverside posts, bridge edge
// strips, rooftop aviation lights and landmark flood pools. Every material is
// registered in nightMaterials so the existing environment tween drives it.
// Placement is procedural (road centrelines + OSM shoreline), not a survey.

const ROAD_KINDS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const LAMP_SPACING = 4.6;      // world units (12 m each)
const PROMENADE_SPACING = 7;

function pointInPolygon(x, z, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
  }
  return hit;
}

function radialTexture(size, stops) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([offset, alpha]) => gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`));
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function additive(map, color, opacity) {
  return new THREE.MeshBasicMaterial({
    map, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  });
}

function pointsMaterial(map, color, size, opacity) {
  return new THREE.PointsMaterial({
    map, color, size, sizeAttenuation: true,
    transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false
  });
}

function instance(geometry, material, positions) {
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  const dummy = new THREE.Object3D();
  positions.forEach((p, index) => {
    dummy.position.set(p[0], p[1], p[2]);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function flatPools(texture, material, positions) {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, positions.length);
  const dummy = new THREE.Object3D();
  dummy.rotation.x = -Math.PI / 2;
  positions.forEach((p, index) => {
    dummy.position.set(p[0], p[1], p[2]);
    dummy.scale.set(p[3], p[3], 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export function buildCityLights(scene, district, nightMaterials, bridges = {}) {
  const { heightAt, data, boundary } = district;
  const halo = radialTexture(64, [[0, 1], [0.35, 0.55], [1, 0]]);
  const pool = radialTexture(64, [[0, 0.9], [0.5, 0.28], [1, 0]]);

  /* Street lamps: alternate sides of trunk/primary/secondary/tertiary roads. */
  const lamps = [];
  const grid = new Map();
  const cell = 1.7;
  const addLamp = (x, z) => {
    if (x < -361.0) return;
    if (boundary && !pointInPolygon(x, z, boundary)) return;
    const gx = Math.round(x / cell), gz = Math.round(z / cell);
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const bucket = grid.get(`${gx + i},${gz + j}`);
        if (!bucket) continue;
        for (const [px, pz] of bucket) {
          if ((px - x) ** 2 + (pz - z) ** 2 < 4) return;
        }
      }
    }
    const key = `${gx},${gz}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([x, z]);
    const y = heightAt(x, z);
    lamps.push([x, y, z]);
  };

  for (const [, , kind, bridge, points] of data.roads) {
    if (!ROAD_KINDS.has(kind)) continue;
    if (bridge && bridge !== 'no') continue;
    if (points.every(([x]) => x < -361.0)) continue;
    if (boundary && points.every(([x, z]) => !pointInPolygon(x, z, boundary))) continue;
    const half = (kind === 'trunk' || kind === 'primary' ? 20 : 12) / 24;
    let next = LAMP_SPACING * 0.5;
    let side = 1;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      if (ax < -361.0 && bx < -361.0) continue;
      const dx = bx - ax, dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (!length) continue;
      const ux = dx / length, uz = dz / length;
      while (next <= length) {
        const x = ax + ux * next - uz * side * (half + 0.3);
        const z = az + uz * next + ux * side * (half + 0.3);
        addLamp(x, z);
        side = -side;
        next += LAMP_SPACING;
      }
      next -= length;
    }
  }

  /* Riverside promenade posts along the OSM shoreline. */
  const promenade = [];
  const ring = boundary || data.land;
  let walk = PROMENADE_SPACING * 0.5;
  for (let i = 1; i < ring.length; i++) {
    const [ax, az] = ring[i - 1], [bx, bz] = ring[i];
    if (ax < -361.0 && bx < -361.0) continue;
    const dx = bx - ax, dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (!length) continue;
    while (walk <= length) {
      const x = ax + dx / length * walk, z = az + dz / length * walk;
      if (x >= -361.0) {
        promenade.push([x, heightAt(x, z), z]);
      }
      walk += PROMENADE_SPACING;
    }
    walk -= length;
  }

  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7, metalness: 0.4 });
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0, toneMapped: false });
  const haloMaterial = pointsMaterial(halo, 0xffd8a0, 2.2, 0);
  const poolMaterial = additive(pool, 0xffb45e, 0);
  const postMaterial = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0, toneMapped: false });
  const postHaloMaterial = pointsMaterial(halo, 0xffb877, 1.5, 0);
  const postPoolMaterial = additive(pool, 0xff9d4d, 0);

  const nightGroup = new THREE.Group();
  nightGroup.name = 'cityNightGroup';
  scene.add(nightGroup);

  scene.add(instance(new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5), poleMaterial, lamps));
  nightGroup.add(instance(new THREE.BoxGeometry(0.17, 0.09, 0.17), lampMaterial,
    lamps.map(([x, y, z]) => [x, y + 0.93, z])));
  scene.add(instance(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 5), poleMaterial,
    promenade.map(([x, y, z]) => [x, y + 0.25, z])));
  nightGroup.add(instance(new THREE.BoxGeometry(0.11, 0.06, 0.11), postMaterial,
    promenade.map(([x, y, z]) => [x, y + 0.52, z])));

  const lampHalos = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(lamps.map(([x, y, z]) => new THREE.Vector3(x, y + 0.95, z))),
    haloMaterial
  );
  const postHalos = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(promenade.map(([x, y, z]) => new THREE.Vector3(x, y + 0.54, z))),
    postHaloMaterial
  );
  lampHalos.frustumCulled = postHalos.frustumCulled = false;
  nightGroup.add(lampHalos, postHalos);

  nightGroup.add(flatPools(pool, poolMaterial, lamps.map(([x, y, z]) => [x, y + 0.14, z, 3.6])));
  nightGroup.add(flatPools(pool, postPoolMaterial, promenade.map(([x, y, z]) => [x, y + 0.13, z, 3.0])));

  /* Low warm reflection band straddling the shoreline; the land half is buried. */
  const bandVertices = [];
  for (let i = 1; i < ring.length; i++) {
    const [ax, az] = ring[i - 1], [bx, bz] = ring[i];
    if (ax < -361.0 && bx < -361.0) continue;
    const dx = bx - ax, dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (!length) continue;
    const nx = -dz / length * 1.1, nz = dx / length * 1.1;
    const y = 0.34;
    bandVertices.push(
      ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz,
      ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz
    );
  }
  const bandGeometry = new THREE.BufferGeometry();
  bandGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bandVertices, 3));
  const bandMaterial = additive(null, 0xffa860, 0);
  bandMaterial.opacity = 0;
  nightGroup.add(new THREE.Mesh(bandGeometry, bandMaterial));

  /* Rooftop aviation beacons on buildings with a measured height. */
  const aviation = [];
  for (const [, , measuredHeight, , footprint] of data.buildings) {
    if (typeof measuredHeight !== 'number' || measuredHeight < 60) continue;
    const cx = footprint.reduce((sum, p) => sum + p[0], 0) / footprint.length;
    if (cx < -361.0) continue;
    const cz = footprint.reduce((sum, p) => sum + p[1], 0) / footprint.length;
    const ground = Math.max(...footprint.map(([x, z]) => heightAt(x, z)));
    aviation.push([cx, ground + measuredHeight / 12 + 0.25, cz]);
  }
  const aviationMaterial = pointsMaterial(halo, 0xff3322, 1.2, 0);
  const beacons = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(aviation.map(p => new THREE.Vector3(...p))),
    aviationMaterial
  );
  beacons.frustumCulled = false;
  nightGroup.add(beacons);

  /* Bridge deck edge strips + lower chord + pylon flood. */
  const stripMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd7a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  });
  const chordMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb040, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  });
  // Qiansimen: one spindle tower at 58%. Dongshuimen: north 20%, south 80%.
  for (const [config, pylonTs, floodIntensity] of [
    [bridges.qiansimen, [0.58], 80],
    [bridges.dongshuimen, [0.2, 0.8], 60]
  ]) {
    if (!config) continue;
    for (const side of [-1, 1]) {
      const a = config.pStart.clone().addScaledVector(config.normalVec, side * 1.04);
      const b = config.pEnd.clone().addScaledVector(config.normalVec, side * 1.04);
      a.y += 0.45; b.y += 0.45;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, a.distanceTo(b)), stripMaterial);
      strip.position.copy(a).add(b).multiplyScalar(0.5);
      strip.lookAt(b);
      nightGroup.add(strip);

      const lowA = a.clone(), lowB = b.clone();
      lowA.y -= 0.9; lowB.y -= 0.9;
      const chord = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, lowA.distanceTo(lowB)), chordMaterial);
      chord.position.copy(lowA).add(lowB).multiplyScalar(0.5);
      chord.lookAt(lowB);
      nightGroup.add(chord);
    }
    for (const pylonT of pylonTs) {
      const pylon = new THREE.Vector3().lerpVectors(config.pStart, config.pEnd, pylonT);
      // Paired deck-edge floods, low and clear of the pier, so the tower is
      // brightest at its foot and falls off toward the tip.
      for (const side of [-1, 1]) {
        const flood = new THREE.PointLight(0xffb86c, 0, 70, 1.35);
        flood.position.copy(pylon).addScaledVector(config.normalVec, side * 3.4);
        flood.position.y = config.pStart.y + 0.6;
        nightGroup.add(flood);
        nightMaterials.push({ material: flood, property: 'intensity', baseIntensity: floodIntensity * 0.42 });
      }
    }
  }

  /* Landmark flood pools and two warm point lights. */
  const landmarkPools = [
    [district.jiefangbei, 5.5, 0.5],
    [district.auditorium, 10, 0.45],
    [district.hongyadong, 9, 0.55]
  ];
  const landmarkGroup = new THREE.Group();
  for (const [position, radius, strength] of landmarkPools) {
    const material = additive(pool, 0xffb066, 0);
    nightMaterials.push({ material, property: 'opacity', baseIntensity: strength });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(position.x, position.y + 0.18, position.z);
    mesh.renderOrder = 3;
    landmarkGroup.add(mesh);
  }
  nightGroup.add(landmarkGroup);
  for (const [position, height, distance] of [[district.hongyadong, 3.2, 22], [district.jiefangbei, 2.4, 16]]) {
    const light = new THREE.PointLight(0xffb070, 0, distance, 1.7);
    light.position.set(position.x, position.y + height, position.z);
    nightGroup.add(light);
    nightMaterials.push({ material: light, property: 'intensity', baseIntensity: 26 });
  }

  /* Register the night-only materials with the shared environment tween. */
  nightMaterials.push(
    { material: lampMaterial, property: 'opacity', baseIntensity: 1 },
    { material: haloMaterial, property: 'opacity', baseIntensity: 1 },
    { material: poolMaterial, property: 'opacity', baseIntensity: 0.42 },
    { material: postMaterial, property: 'opacity', baseIntensity: 1 },
    { material: postHaloMaterial, property: 'opacity', baseIntensity: 0.9 },
    { material: postPoolMaterial, property: 'opacity', baseIntensity: 0.45 },
    { material: bandMaterial, property: 'opacity', baseIntensity: 0.14 },
    { material: aviationMaterial, property: 'opacity', baseIntensity: 0.85 },
    { material: stripMaterial, property: 'opacity', baseIntensity: 1 },
    { material: chordMaterial, property: 'opacity', baseIntensity: 0.85 }
  );

  return { lampCount: lamps.length, promenadeCount: promenade.length, beaconCount: aviation.length, nightGroup };
}
