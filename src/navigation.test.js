import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  SHIBATI_FACTS, HONGYADONG_FACTS, CHAOTIANMEN_FACTS, STEP_RISER_M,
  classifyGrade, legKind, resamplePolyline, resamplePath3D, smoothProfile,
  classifySamples, summarizeRoute, estimateSteps, splitFlights, sampleProfile,
  pointAt, clampFloor, floorElevation, floorAtDistance, createNavState, navTransition
} from './nav-model.js';
import { sampleElevation } from './elevation.js';
import { buildShibatiSamples, buildHongyadongSamples, buildChaotianmenSamples, frameFacadePose } from './navigation.js';

const here = path => fileURLToPath(new URL(path, import.meta.url));

function decodeSnapshot(file) {
  const payload = JSON.parse(readFileSync(here(file), 'utf8'));
  return JSON.parse(inflateSync(Buffer.from(payload.data, 'base64')).toString());
}

test('segment classification separates stairs, ramps and flat ground', () => {
  assert.equal(classifyGrade(0.32), 'steps');
  assert.equal(classifyGrade(-0.2), 'steps');
  assert.equal(classifyGrade(0.06), 'ramp');
  assert.equal(classifyGrade(0.01), 'flat');
  // A mapped stairway stays stairs on a flat stretch only if it is truly level.
  assert.equal(legKind(0.001, 'steps'), 'flat');
  assert.equal(legKind(0.09, 'steps'), 'steps');
  // A street is only called stairs when it is steeper than any street would be.
  assert.equal(legKind(0.05, 'street'), 'ramp');
  assert.equal(legKind(0.22, 'street'), 'steps');
});

test('resamplePolyline keeps spacing, length and endpoints', () => {
  const heightAt = (x) => x * 0.5;
  const samples = resamplePolyline(
    [{ x: 0, z: 0 }, { x: 1, z: 0, kind: 'steps' }, { x: 1, z: 1, kind: 'steps' }],
    { spacing: 1.5, scale: 12, heightAt }
  );
  assert.equal(samples[0].d, 0);
  assert.equal(samples.at(-1).d, 24);
  assert.equal(samples.at(-1).x, 1);
  assert.equal(samples.at(-1).z, 1);
  assert.equal(samples[1].kind, 'steps');
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].d > samples[i - 1].d);
  }
});

test('resamplePath3D interpolates heights along a vertical run', () => {
  const samples = resamplePath3D([
    { x: 0, y: 0, z: 0, kind: 'steps' },
    { x: 0, y: 1, z: 0, kind: 'steps' }
  ], { spacing: 1.5, scale: 12 });
  assert.equal(samples.at(-1).d, 12);
  assert.equal(samples.at(-1).y, 1);
  assert.equal(samples[0].kind, 'steps');
});

test('summarizeRoute reports distance, ascent, descent and max grade', () => {
  // 120 m flat-ish descent of 12 m, sampled in model units.
  const samples = [];
  for (let i = 0; i <= 10; i++) {
    samples.push({ x: 0, y: -0.1 * i, z: -i, d: i * 12 });
  }
  const stats = summarizeRoute(samples, { scale: 12 });
  assert.ok(Math.abs(stats.distance - Math.hypot(120, 12)) < 0.01);
  assert.ok(Math.abs(stats.descent - 12) < 1e-6);
  assert.equal(stats.ascent, 0);
  assert.ok(Math.abs(stats.maxGrade - 0.1) < 1e-6);
});

test('smoothing and classification merge short runs', () => {
  const samples = [];
  for (let i = 0; i <= 40; i++) {
    samples.push({ x: 0, y: -i * 0.02, z: -i * 0.1, d: i * 1.5, kind: 'steps' });
  }
  samples[20].y += 0.3; // one noisy sample must not become its own colour band
  const smoothed = smoothProfile(samples, { windowM: 12 });
  const { runs } = classifySamples(smoothed, { scale: 12, minRun: 5 });
  assert.ok(runs.length <= 2, `expected merged runs, got ${runs.length}`);
});

test('step estimate and flight split follow the published platform count', () => {
  assert.equal(estimateSteps(3.4), Math.round(3.4 / STEP_RISER_M));
  const samples = [];
  for (let i = 0; i <= 17 * 4; i++) {
    samples.push({ x: 0, y: -i * 0.055, z: -i * 0.25, d: i * 6 });
  }
  const flights = splitFlights(samples, SHIBATI_FACTS.platforms, { scale: 12 });
  assert.equal(flights.length, SHIBATI_FACTS.platforms - 1);
  const total = flights.reduce((sum, flight) => sum + flight.steps, 0);
  const drop = 17 * 4 * 0.055 * 12;
  assert.ok(Math.abs(total - drop / STEP_RISER_M) <= flights.length);
});

test('profile sampling spans the whole route', () => {
  const samples = [];
  for (let i = 0; i <= 20; i++) samples.push({ x: 0, y: -i * 0.1, z: -i, d: i * 10, kind: 'steps' });
  const profile = sampleProfile(samples, 24, { scale: 12, datum: 167 });
  assert.equal(profile.length, 24);
  assert.equal(profile[0].d, 0);
  assert.ok(Math.abs(profile.at(-1).d - 200) < 1e-6);
  assert.ok(Math.abs(profile[0].h - 167) < 1e-6);
  for (let i = 1; i < profile.length; i++) assert.ok(profile[i].d >= profile[i - 1].d);
});

test('pointAt clamps outside the route', () => {
  const samples = [
    { x: 0, y: 0, z: 0, d: 0, kind: 'flat' },
    { x: 1, y: 0, z: 0, d: 10, kind: 'steps' }
  ];
  assert.equal(pointAt(samples, -5).d, 0);
  assert.equal(pointAt(samples, 99).d, 10);
  assert.ok(Math.abs(pointAt(samples, 5).x - 0.5) < 1e-9);
});

test('floor selection stays inside 1..11', () => {
  assert.equal(clampFloor(0), 1);
  assert.equal(clampFloor(12), 11);
  assert.equal(clampFloor(3.6), 4);
  const floorHeight = HONGYADONG_FACTS.heightM / HONGYADONG_FACTS.floors;
  const rise = floorElevation(11, { baseY: 0.7, floorHeight }) - floorElevation(1, { baseY: 0.7, floorHeight });
  assert.ok(Math.abs(rise - (floorHeight * 10)) < 1e-9);
  assert.ok(rise > 65 && rise < 80, `published rise ${rise.toFixed(1)} m`);
});

test('model floor height puts 1F→11F in the ~75 m range', () => {
  const floorHeight = HONGYADONG_FACTS.modelHeightM / HONGYADONG_FACTS.floors / 12;
  const rise = floorElevation(11, { baseY: 0.7, floorHeight }) - floorElevation(1, { baseY: 0.7, floorHeight });
  assert.ok(Math.abs(rise * 12 - 10 * HONGYADONG_FACTS.modelHeightM / HONGYADONG_FACTS.floors) < 1e-9);
  assert.ok(Math.abs(rise * 12 - 75) < 10, `model rise ${(rise * 12).toFixed(1)} m`);
});

test('floorAtDistance maps route distance onto 1..11', () => {
  const starts = Array.from({ length: 11 }, (_, index) => ({ level: index + 1, d: index * 10 }));
  assert.equal(floorAtDistance(starts, 0), 1);
  assert.equal(floorAtDistance(starts, -5), 1);
  assert.equal(floorAtDistance(starts, 5), 1);
  assert.equal(floorAtDistance(starts, 55), 6);
  assert.equal(floorAtDistance(starts, 100), 11);
  assert.equal(floorAtDistance(starts, 500), 11);
});

test('published figures match the handoff brief', () => {
  assert.equal(SHIBATI_FACTS.lengthM, 400);
  assert.deepEqual(SHIBATI_FACTS.descentRangeM, [60, 70]);
  assert.equal(SHIBATI_FACTS.platforms, 18);
  assert.equal(SHIBATI_FACTS.stepsLabel, '200+');
  assert.equal(HONGYADONG_FACTS.floors, 11);
  assert.equal(HONGYADONG_FACTS.heightM, 75);
  assert.equal(HONGYADONG_FACTS.modelHeightM, 79);
  assert.deepEqual(HONGYADONG_FACTS.entrances, [1, 4, 11]);
});

test('十八梯 demo route against the real terrain grid', () => {
  const data = decodeSnapshot('./peninsula-snapshot.json');
  const elevation = decodeSnapshot('./peninsula-elevation.json');
  const scale = data.meta.metersPerUnit;
  const heightAt = (x, z) => Math.max(0.7, (sampleElevation(
    elevation,
    data.meta.origin[0] + x * scale / 96800,
    data.meta.origin[1] - z * scale / 111320
  ) - 167) / scale);

  const { stats, flights, totalSteps, samples } = buildShibatiSamples({ heightAt, scale });

  // Model estimate: the 80 m SRTM grid smooths the flights, so it lands below the
  // published 60-70 m drop. The demo reports the model number and never inflates it.
  assert.ok(stats.descent > 25 && stats.descent < 60, `descent ${stats.descent.toFixed(1)} m`);
  assert.ok(stats.distance > 380 && stats.distance < 470, `distance ${stats.distance.toFixed(0)} m`);
  assert.ok(stats.maxGrade > 0.08 && stats.maxGrade < 0.45);
  assert.ok(stats.ascent < 8, `ascent ${stats.ascent.toFixed(1)} m`);
  assert.equal(flights.length, SHIBATI_FACTS.platforms - 1);
  // The published "200+ steps" is the same order of magnitude as the model count.
  assert.ok(totalSteps > 150 && totalSteps < 320, `steps ${totalSteps}`);
  assert.ok(samples.every(sample => sample.y >= 0.7));
  assert.ok(samples.every(sample => ['steps', 'ramp', 'flat'].includes(sample.kind)));
});

test('洪崖洞 zigzag climbs 11 floors in world space', () => {
  const base = { x: -108.9, y: 0.7, z: 59.6 };
  const floorHeight = HONGYADONG_FACTS.heightM / HONGYADONG_FACTS.floors / 12;
  const built = buildHongyadongSamples({ base, floorHeight, floors: 11, scale: 12 });

  assert.equal(built.floorStarts.length, 11);
  assert.ok(Math.abs(built.samples[0].x - base.x) < 8, 'route sits on the model, not at the origin');
  assert.ok(Math.abs(built.samples[0].z - base.z) < 4);
  assert.ok(built.length > 300 && built.length < 500, `length ${built.length.toFixed(0)} m`);
  const top = built.samples.at(-1);
  assert.ok(Math.abs(top.y - (base.y + 10.15 * floorHeight)) < 0.01, 'top of the route is the 11F floor');
  // Every floor start is further along than the previous one, and lands on that floor.
  for (let i = 1; i < built.floorStarts.length; i++) {
    assert.ok(built.floorStarts[i].d > built.floorStarts[i - 1].d);
  }
  for (const floor of built.floorStarts) {
    const point = pointAt(built.samples, floor.d);
    const expected = base.y + (floor.level - 0.85) * floorHeight;
    assert.ok(Math.abs(point.y - expected) < 0.05, `${floor.level}F marker at y ${point.y.toFixed(2)}, expected ${expected.toFixed(2)}`);
  }
});

test('洪崖洞 route statistics and profile stay finite', () => {
  const base = { x: -108.9, y: 0.7, z: 59.6 };
  const floorHeight = HONGYADONG_FACTS.modelHeightM / HONGYADONG_FACTS.floors / 12;
  const built = buildHongyadongSamples({ base, floorHeight, floors: 11, scale: 12 });
  const { samples } = classifySamples(built.samples, { scale: 12, minRun: 3 });
  const stats = summarizeRoute(samples, { scale: 12 });
  const profile = sampleProfile(samples, 44, { scale: 12, datum: -base.y * 12 });

  assert.equal(profile.length, 44);
  for (const value of [stats.distance, stats.ascent, stats.descent, stats.maxGrade]) {
    assert.ok(Number.isFinite(value), `non-finite stat ${value}`);
  }
  assert.ok(stats.distance > 300 && stats.distance < 500);
  assert.ok(profile.every(point => Number.isFinite(point.d) && Number.isFinite(point.h)));
  assert.ok(profile.at(-1).h - profile[0].h > 65);
});

test('洪崖洞 camera pose keeps 1F and 11F in view', () => {
  const base = { x: -108.9, y: 0.7, z: 59.6 };
  const floorHeight = HONGYADONG_FACTS.modelHeightM / HONGYADONG_FACTS.floors / 12;
  const pose = frameFacadePose({
    base, floorHeight, floors: 11, width: 145 / 12, depth: 22 / 12,
    camera: { fov: 36, aspect: 1.6 }
  });
  for (const value of [pose.pos.x, pose.pos.y, pose.pos.z, pose.target.x, pose.target.y, pose.target.z]) {
    assert.ok(Number.isFinite(value));
  }
  assert.ok(pose.pos.z < base.z, 'camera stands on the river side of the facade');
  assert.ok(pose.pos.y > base.y && pose.pos.y < base.y + 11 * floorHeight);
  const distance = pose.pos.distanceTo(pose.target);
  const halfHeight = 11 * floorHeight / 2;
  assert.ok(distance > halfHeight / Math.tan((36 * Math.PI / 180) / 2));
});

function terrainSampler() {
  const data = decodeSnapshot('./peninsula-snapshot.json');
  const elevation = decodeSnapshot('./peninsula-elevation.json');
  const scale = data.meta.metersPerUnit;
  const heightAt = (x, z) => Math.max(0.7, (sampleElevation(
    elevation,
    data.meta.origin[0] + x * scale / 96800,
    data.meta.origin[1] - z * scale / 111320
  ) - 167) / scale);
  return { heightAt, scale };
}

test('朝天门 long slope: length, net drop, segments and endpoints', () => {
  const { heightAt, scale } = terrainSampler();
  const { samples, runs, stats, netDropM } = buildChaotianmenSamples({ heightAt, scale });

  assert.ok(stats.distance > 1400 && stats.distance < 1850, `distance ${stats.distance.toFixed(0)} m`);
  assert.ok(netDropM > 80 && netDropM < 120, `net drop ${netDropM.toFixed(1)} m`);
  assert.ok(stats.maxGrade > 0.05 && stats.maxGrade < 0.5, `max grade ${stats.maxGrade.toFixed(2)}`);

  const startElev = samples[0].y * scale + 167;
  const endElev = samples[samples.length - 1].y * scale + 167;
  assert.ok(startElev > 250 && startElev < 300, `start ${startElev.toFixed(0)} m`);
  assert.ok(endElev > 160 && endElev < 195, `end ${endElev.toFixed(0)} m`);

  const kinds = new Set(samples.map(sample => sample.kind));
  assert.ok(kinds.has('steps'), 'the landing stairway must classify as steps');
  assert.ok(kinds.has('ramp') || kinds.has('flat'), 'the street leg must classify as slope or flat');
  assert.ok(samples.every(sample => Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.z)));

  const lastStepRun = [...runs].reverse().find(run => run.kind === 'steps');
  assert.ok(lastStepRun, 'a stair run exists');
  assert.ok(samples[lastStepRun.end].d > samples[samples.length - 1].d * 0.7, 'steps reach the river end');
});

test('navigation mode: select does not play, back keeps nav mode, exit leaves it', () => {
  let state = createNavState();
  assert.equal(state.mode, 'browse');
  assert.equal(state.navActive, false);

  state = navTransition(state, { type: 'select', id: 'shibati' });
  assert.equal(state.mode, 'overview');
  assert.equal(state.playing, false);
  assert.equal(state.started, false);
  assert.equal(state.navActive, true);

  state = navTransition(state, { type: 'play', length: 400 });
  assert.equal(state.mode, 'playing');
  assert.equal(state.playing, true);
  state = navTransition(state, { type: 'tick', delta: 100, length: 400 });
  assert.equal(state.d, 100);
  state = navTransition(state, { type: 'pause' });
  assert.equal(state.playing, false);

  state = navTransition(state, { type: 'back' });
  assert.equal(state.mode, 'browse');
  assert.equal(state.routeId, null);
  assert.equal(state.navActive, true, 'back keeps navigation mode for the next card');

  state = navTransition(navTransition(state, { type: 'select', id: 'chaotianmen' }), { type: 'exit' });
  assert.equal(state.navActive, false);
  assert.equal(state.mode, 'browse');

  const idle = navTransition(createNavState(), { type: 'play', length: 400 });
  assert.equal(idle.playing, false, 'play does nothing without a selected route');

  let run = navTransition(navTransition(createNavState(), { type: 'select', id: 'x' }), { type: 'play', length: 50 });
  run = navTransition(run, { type: 'tick', delta: 80, length: 50 });
  assert.equal(run.d, 50);
  assert.equal(run.playing, false);
});
