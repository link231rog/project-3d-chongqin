import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { sampleElevation } from './elevation.js';
import {
  RAFFLES_ANCHOR, RAFFLES_ROTATION_Y, RAFFLES_SCALE, RAFFLES_TOWERS, RAFFLES_TOWER_CENTRE,
  RAFFLES_PODIUM, RAFFLES_PODIUM_BASE_Y, RAFFLES_BRIDGE, RAFFLES_BRIDGE_CENTRE, RAFFLES_CRYSTAL,
  bridgeSupports, loftTowerGeometry, polygonArea, polygonCentroid, localToWorld, worldToLocal
} from './raffles-layout.js';

// Area centroids of the projected OSM footprints (way 748910920 etc.), computed from the
// published node coordinates, not from the model.
const OSM_TOWER_CENTRES = {
  T1: [-56.7, 34.68], T2: [-49.33, 28.81], T3S: [-43.52, 30.34], T4S: [-38.48, 32.32],
  T5: [-33.26, 35.23], T6: [-32.01, 44.69], T3N: [-42.02, 24.94], T4N: [-35.83, 27.45]
};
const OSM_TOWER_AREAS = {
  T1: 11.61, T2: 11.64, T3S: 12.38, T4S: 12.64, T5: 11.74, T6: 11.6, T3N: 10.6, T4N: 10.51
};

test('tower centres round-trip to the OSM footprints', () => {
  for (const tower of RAFFLES_TOWERS) {
    const [wx, wz] = localToWorld([tower.centre.x, tower.centre.z]);
    const [ox, oz] = OSM_TOWER_CENTRES[tower.name];
    assert.ok(Math.hypot(wx - ox, wz - oz) < 0.02, `${tower.name} off by ${Math.hypot(wx - ox, wz - oz).toFixed(3)} units`);
    assert.ok(Math.abs(polygonArea(tower.footprint) * RAFFLES_SCALE ** 2 - OSM_TOWER_AREAS[tower.name]) < 0.1, `${tower.name} footprint area`);
  }
});

test('eight-tower geographic centre matches OSM', () => {
  const [wx, wz] = localToWorld([RAFFLES_TOWER_CENTRE.x, RAFFLES_TOWER_CENTRE.z]);
  const osm = Object.values(OSM_TOWER_CENTRES).reduce((sum, [x, z]) => [sum[0] + x / 8, sum[1] + z / 8], [0, 0]);
  assert.ok(Math.hypot(wx - osm[0], wz - osm[1]) < 0.05);
  // The anchor is the eight-tower centroid, so local coordinates stay near the origin.
  assert.ok(Math.hypot(RAFFLES_TOWER_CENTRE.x, RAFFLES_TOWER_CENTRE.z) < 0.05);
});

test('podium and Crystal keep their OSM centres and size', () => {
  const [px, pz] = localToWorld([polygonCentroid(RAFFLES_PODIUM).x, polygonCentroid(RAFFLES_PODIUM).z]);
  assert.ok(Math.hypot(px + 42.89, pz - 34.66) < 0.1, `podium centre ${px.toFixed(2)},${pz.toFixed(2)}`);
  assert.ok(Math.abs(polygonArea(RAFFLES_PODIUM) * RAFFLES_SCALE ** 2 * 144 - 68235) < 900, 'podium area in m2');

  const [bx, bz] = localToWorld([RAFFLES_BRIDGE_CENTRE.x, RAFFLES_BRIDGE_CENTRE.z]);
  // The centreline is sampled evenly along x, so it sits ~1 unit east of the band's
  // area centroid (the OSM band widens at its west end).
  assert.ok(Math.hypot(bx + 41.98, bz - 31.16) < 1.2, `Crystal centre ${bx.toFixed(2)},${bz.toFixed(2)}`);
  const length = Math.hypot(RAFFLES_BRIDGE.at(-1)[0] - RAFFLES_BRIDGE[0][0], RAFFLES_BRIDGE.at(-1)[1] - RAFFLES_BRIDGE[0][1]);
  assert.ok(Math.abs(length * 12 * RAFFLES_SCALE - 300) < 40, `Crystal length ${(length * 9.36).toFixed(0)} m`);
});

test('Crystal is carried by T2, T3S, T4S and T5', () => {
  const supports = bridgeSupports();
  assert.deepEqual(supports.map(tower => tower.name), ['T2', 'T3S', 'T4S', 'T5']);
  for (const tower of supports) {
    // Each support tower must straddle the Crystal centreline in plan.
    const nearest = RAFFLES_BRIDGE.reduce((best, point) =>
      Math.abs(point[0] - tower.centre.x) < Math.abs(best[0] - tower.centre.x) ? point : best);
    assert.ok(Math.abs(nearest[1] - tower.centre.z) < 1.6, `${tower.name} sits ${Math.abs(nearest[1] - tower.centre.z).toFixed(2)} units off the Crystal`);
  }
  assert.ok(RAFFLES_CRYSTAL.width > 3.2 && RAFFLES_CRYSTAL.width < 3.8, 'Crystal width in local units');
  assert.ok(RAFFLES_CRYSTAL.y + RAFFLES_CRYSTAL.height / 2 <= 20 + 39 + 0.2, 'Crystal rests on the 250 m tower tops');
});

test('local frame is aligned with the Crystal axis', () => {
  const axis = Math.atan2(RAFFLES_BRIDGE.at(-1)[1] - RAFFLES_BRIDGE[0][1], RAFFLES_BRIDGE.at(-1)[0] - RAFFLES_BRIDGE[0][0]);
  assert.ok(Math.abs(axis) < 0.03, `bridge axis in local frame ${(axis * 180 / Math.PI).toFixed(2)} deg`);
  assert.ok(Math.abs(RAFFLES_ROTATION_Y + 0.3759) < 0.001);
});

test('world <-> local is reversible', () => {
  const point = [12.5, -7.25];
  const back = worldToLocal(localToWorld(point));
  assert.ok(Math.hypot(back[0] - point[0], back[1] - point[1]) < 1e-9);
});

test('loft builds a closed leaning shell', () => {
  const tower = RAFFLES_TOWERS.find(item => item.name === 'T2');
  const height = 39, lean = 2, taper = 0.16, segments = 14;
  const { positions, uvs, indices, topShift, topScale } = loftTowerGeometry(tower.footprint, { height, lean, taper, segments });
  const vertexCount = positions.length / 3;
  assert.equal(uvs.length / 2, vertexCount);
  assert.ok(indices.every(index => index >= 0 && index < vertexCount));
  assert.equal(indices.length, 6 * tower.footprint.length * segments + 3 * tower.footprint.length);
  assert.ok(Math.abs(topShift - lean * Math.sin(Math.PI * 0.75)) < 1e-9);
  assert.ok(Math.abs(topScale - (1 - taper)) < 1e-9);

  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    minY = Math.min(minY, positions[i]);
    maxY = Math.max(maxY, positions[i]);
  }
  assert.ok(Math.abs(minY) < 1e-9 && Math.abs(maxY - height) < 1e-9);
});

test('loft normals face outwards', () => {
  const tower = RAFFLES_TOWERS.find(item => item.name === 'T2');
  const { positions, indices } = loftTowerGeometry(tower.footprint, { height: 39, segments: 2 });
  const vertex = index => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
  const [a, b, c] = [0, 1, 2].map(i => vertex(indices[i]));
  const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    edge1[1] * edge2[2] - edge1[2] * edge2[1],
    edge1[2] * edge2[0] - edge1[0] * edge2[2],
    edge1[0] * edge2[1] - edge1[1] * edge2[0]
  ];
  const midX = (a[0] + b[0] + c[0]) / 3;
  const midZ = (a[2] + b[2] + c[2]) / 3;
  assert.ok(normal[0] * midX + normal[2] * midZ > 0, 'side triangle winds outwards');
});

test('anchor stays on the tower block, not the podium centroid', () => {
  const [ax, az] = localToWorld([0, 0]);
  assert.ok(Math.hypot(ax - RAFFLES_ANCHOR.x, az - RAFFLES_ANCHOR.z) < 1e-9);
  assert.ok(RAFFLES_SCALE > 0.7 && RAFFLES_SCALE < 0.9);
});

test('podium base stays under the ground it stands on', () => {
  const decode = file => JSON.parse(zlib.inflateSync(Buffer.from(
    JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8')).data, 'base64'
  )).toString());
  const snapshot = decode('./peninsula-snapshot.json');
  const elevation = decode('./peninsula-elevation.json');
  const scale = snapshot.meta.metersPerUnit;
  const heightAt = (x, z) => Math.max(0.7, (sampleElevation(elevation,
    snapshot.meta.origin[0] + x * scale / 96800,
    snapshot.meta.origin[1] - z * scale / 111320) - 167) / scale);

  // main.js puts local y 10 on the anchor's ground; the podium roof is y 20.
  const groupY = heightAt(RAFFLES_ANCHOR.x, RAFFLES_ANCHOR.z) - 10 * 0.435;
  const base = groupY + RAFFLES_PODIUM_BASE_Y * 0.435;
  let lowest = Infinity;
  for (const [lx, lz] of RAFFLES_PODIUM) {
    const [wx, wz] = localToWorld([lx, lz]);
    lowest = Math.min(lowest, heightAt(wx, wz));
  }
  assert.ok(base < lowest, `podium base ${base.toFixed(2)} sits above ground ${lowest.toFixed(2)}`);
  assert.ok(groupY + 20 * 0.435 > lowest + 1, 'podium roof stays clear of the ground');
});
