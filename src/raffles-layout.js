// Raffles City (重庆来福士) layout derived from OpenStreetMap building footprints.
// District units: 1 unit = 12 m, +x east, +z south (see peninsula.js project()).
// Ways: 1307164454 podium, 661717188 Crystal skybridge, 661717190 T2, 661717191 T3S,
// 748910916 T3N, 748910917 T4N, 748910918 T4S, 748910919 T5, 748910920 T1, 748910921 T6.
// Polygons are the projected OSM nodes (rounded to 1 cm = 2 cm on the ground), not a survey.

export const RAFFLES_METERS_PER_UNIT = 12;

// Group anchor: centroid of the eight tower footprints. The podium centre sits ~4 units
// north-west of it, so the shared district.raffles anchor (podium centroid) is left alone
// for the camera presets and the bridge alignment.
export const RAFFLES_ANCHOR = { x: -41.41, z: 32.3 };
// Rotation that puts local +x along the Crystal axis (PCA of way 661717188 = 21.54 deg).
export const RAFFLES_ROTATION_Y = -0.3759;
export const RAFFLES_SCALE = 0.78;

// Crystal envelope: 300 m long, 32.5 m wide, 22.5 m high (Safdie / press figures).
export const RAFFLES_CRYSTAL = {
  width: 32.5 / RAFFLES_METERS_PER_UNIT / RAFFLES_SCALE,
  height: 22.5 / RAFFLES_METERS_PER_UNIT / RAFFLES_SCALE,
  // Centre of the tube at 250 m above the podium roof, i.e. just under the 250 m tower tops.
  y: 57.9
};

const OSM = {
  towers: [
    { id: '748910920', name: 'T1', height: 250, levels: 46, poly: [[-58.3, 36.73], [-57.65, 32.27], [-55.1, 32.64], [-55.75, 37.1]] },
    { id: '661717190', name: 'T2', height: 250, levels: 46, poly: [[-48.37, 31.21], [-47.71, 26.8], [-50.3, 26.42], [-50.95, 30.82]] },
    { id: '661717191', name: 'T3S', height: 250, levels: 46, poly: [[-43.01, 33.03], [-41.59, 28.41], [-44.04, 27.65], [-45.45, 32.27]] },
    { id: '748910918', name: 'T4S', height: 250, levels: 46, poly: [[-38.6, 29.57], [-36.25, 30.72], [-38.36, 35.07], [-40.71, 33.92]] },
    { id: '748910919', name: 'T5', height: 250, levels: 46, poly: [[-30.9, 34.17], [-33.48, 37.82], [-35.62, 36.29], [-33.03, 32.64]] },
    { id: '748910921', name: 'T6', height: 250, levels: 46, poly: [[-31.78, 42.11], [-29.67, 43.59], [-32.23, 47.28], [-34.34, 45.8]] },
    { id: '748910916', name: 'T3N', height: 350, levels: 77, poly: [[-43.08, 22.89], [-40, 23.85], [-40.97, 26.99], [-44.05, 26.03]] },
    { id: '748910917', name: 'T4N', height: 350, levels: 77, poly: [[-37.99, 28.2], [-36.57, 25.28], [-33.67, 26.7], [-35.08, 29.63]] }
  ],
  podium: [
    [-37.43, 38.96], [-37.5, 39.47], [-36.78, 39.88], [-35.76, 40.58], [-35.8, 41.09], [-36.32, 47.92],
    [-35.86, 48.49], [-32.81, 49.68], [-30.97, 50.44], [-30.04, 49.75], [-29.52, 49.73], [-29.77, 47.41],
    [-29.82, 46.87], [-29.9, 46.04], [-29.95, 45.48], [-29.04, 44.21], [-29.39, 40.82], [-30.53, 40],
    [-30.96, 35.67], [-30.13, 34.61], [-30.23, 33.62], [-30.4, 32.08], [-31.36, 31.39], [-31.63, 28.28],
    [-31.84, 28.18], [-31.5, 27.48], [-34.88, 25.15], [-37.96, 23.7], [-39.34, 23.21], [-40.67, 22.76],
    [-42.41, 22.35], [-44.43, 22.04], [-45.12, 21.97], [-45.36, 22.76], [-45.59, 22.68], [-47.94, 24.67],
    [-49.08, 24.5], [-50.22, 25.44], [-51.11, 26.15], [-51.13, 26.3], [-51.32, 27.51], [-52.96, 28.86],
    [-54.2, 29.91], [-54.62, 30.27], [-55.7, 30.1], [-55.93, 30.07], [-58.53, 32.3], [-58.56, 32.47],
    [-58.74, 33.87], [-59.3, 34.29], [-61.22, 35.96], [-60.15, 37.23], [-59.77, 37.59], [-58.72, 38.1],
    [-57.69, 38.31], [-56.97, 38.2], [-55.79, 37.93], [-54.95, 37.95], [-54.25, 38.26], [-53.88, 38.57],
    [-53.47, 38.96], [-53.19, 39.64], [-53.09, 40.59], [-53.23, 41.42], [-53.67, 42.38], [-54.19, 43.38],
    [-54.39, 43.76], [-54.53, 44.13], [-54.48, 44.5], [-54.2, 44.86], [-53.91, 45.13], [-51.5, 45.58],
    [-48.57, 46.16], [-48.11, 45.8], [-47.97, 45.4], [-46.63, 40.46], [-46.14, 39.11], [-45.68, 38.39],
    [-45.3, 37.97], [-43.85, 37.28], [-42.66, 37.34]
  ],
  // Crystal centreline sampled from the middle of the OSM band, west to east.
  bridge: [[-52.17, 28.09], [-46.74, 29.21], [-41.06, 30.96], [-35.75, 33.67], [-31, 36.51]]
};

export function polygonArea(poly) {
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    twice += x1 * z2 - x2 * z1;
  }
  return Math.abs(twice) / 2;
}

export function polygonCentroid(poly) {
  let twice = 0, x = 0, z = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const cross = x1 * z2 - x2 * z1;
    twice += cross;
    x += (x1 + x2) * cross;
    z += (z1 + z2) * cross;
  }
  if (Math.abs(twice) < 1e-9) {
    return {
      x: poly.reduce((s, p) => s + p[0], 0) / poly.length,
      z: poly.reduce((s, p) => s + p[1], 0) / poly.length
    };
  }
  return { x: x / (3 * twice), z: z / (3 * twice) };
}

// Counter-clockwise in (x, z) so extrusion and loft normals face outwards.
export function counterClockwise(poly) {
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    twice += x1 * z2 - x2 * z1;
  }
  return twice < 0 ? poly.slice().reverse() : poly.slice();
}

export function worldToLocal([x, z], anchor = RAFFLES_ANCHOR, rotationY = RAFFLES_ROTATION_Y, scale = RAFFLES_SCALE) {
  const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
  const dx = x - anchor.x, dz = z - anchor.z;
  return [(dx * cos - dz * sin) / scale, (dx * sin + dz * cos) / scale];
}

export function localToWorld([x, z], anchor = RAFFLES_ANCHOR, rotationY = RAFFLES_ROTATION_Y, scale = RAFFLES_SCALE) {
  const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
  return [anchor.x + scale * (x * cos + z * sin), anchor.z + scale * (-x * sin + z * cos)];
}

// Tower footprint in local coordinates, recentred on its own centroid.
export const RAFFLES_TOWERS = OSM.towers.map(tower => {
  const local = tower.poly.map(point => worldToLocal(point));
  const centre = polygonCentroid(local);
  return {
    ...tower,
    centre,
    footprint: counterClockwise(local.map(([x, z]) => [x - centre.x, z - centre.z])),
    area: polygonArea(local)
  };
});

export const RAFFLES_PODIUM = OSM.podium.map(point => worldToLocal(point));

// The podium roof is the tower base at local y 20. The ground under the outline drops to
// 1.67 local units (SRTM sample), while the group base sits at the anchor's ground (4.11),
// so a podium starting at y 10 floats on the downhill east side. Start it below the lowest
// ground instead; 27 deep keeps the roof at 20.
export const RAFFLES_PODIUM_BASE_Y = -7;
export const RAFFLES_BRIDGE = OSM.bridge.map(point => worldToLocal(point));
export const RAFFLES_BRIDGE_CENTRE = polygonCentroid(OSM.bridge.map(point => worldToLocal(point)));

export const RAFFLES_TOWER_CENTRE = RAFFLES_TOWERS.reduce(
  (sum, tower) => ({ x: sum.x + tower.centre.x / RAFFLES_TOWERS.length, z: sum.z + tower.centre.z / RAFFLES_TOWERS.length }),
  { x: 0, z: 0 }
);

export const RAFFLES_BRIDGE_SUPPORTS = ['T2', 'T3S', 'T4S', 'T5'];

// The four towers the Crystal rests on, in west-to-east order.
export function bridgeSupports(towers = RAFFLES_TOWERS) {
  return towers.filter(tower => RAFFLES_BRIDGE_SUPPORTS.includes(tower.name))
    .sort((a, b) => a.centre.x - b.centre.x);
}

// Lofted tower shell: footprint rings stacked up a leaning, tapering sail.
// Returns raw arrays so the geometry can be built without three.js in tests.
export function loftTowerGeometry(footprint, {
  height,
  segments = 14,
  taper = 0.16,
  lean = 2.0,
  floors = 46,
  bay = 0.45
} = {}) {
  const ring = counterClockwise(footprint);
  const n = ring.length;
  const perimeter = [0];
  for (let i = 1; i <= n; i++) {
    const [x1, z1] = ring[i - 1];
    const [x2, z2] = ring[i % n];
    perimeter.push(perimeter[i - 1] + Math.hypot(x2 - x1, z2 - z1));
  }
  const tileU = bay * 6;
  const tileV = (height / Math.max(1, floors)) * 4;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % n];
    const ua = perimeter[i] / tileU;
    const ub = perimeter[i + 1] / tileU;
    const base = positions.length / 3;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const k = 1 - taper * t;
      const y = height * t;
      const shift = lean * Math.sin(t * Math.PI * 0.75);
      positions.push(ax * k, y, az * k + shift, bx * k, y, bz * k + shift);
      uvs.push(ua, y / tileV, ub, y / tileV);
    }
    for (let s = 0; s < segments; s++) {
      // The ring is clockwise seen from above, so this order leaves normals pointing out.
      const a = base + s * 2;
      indices.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
  }

  // Roof cap: one fan over the top ring, wound so the normal points up.
  const topShift = lean * Math.sin(Math.PI * 0.75);
  const topK = 1 - taper;
  const capBase = positions.length / 3;
  positions.push(0, height, topShift);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < n; i++) {
    positions.push(ring[i][0] * topK, height, ring[i][1] * topK + topShift);
    uvs.push(0.5, 0.5);
  }
  for (let i = 0; i < n; i++) {
    indices.push(capBase, capBase + 1 + (i + 1) % n, capBase + 1 + i);
  }

  return { positions, uvs, indices, topShift, topScale: topK };
}

// Two front corners of a footprint (largest z), used for the LED ribbons.
export function frontCorners(footprint) {
  const sorted = footprint.slice().sort((a, b) => b[1] - a[1]);
  return [sorted[0], sorted[1]];
}
