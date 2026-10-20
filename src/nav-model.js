// Pure route maths for the navigation demo: no three.js, no DOM.
// Everything here works in model units; distances are reported in metres.

export const MODEL_SCALE = 12;
// Public descriptions give "200+ steps" over a 60-70 m drop. 0.17 m is a normal
// outdoor riser, so the step count is a model estimate, never a survey.
export const STEP_RISER_M = 0.17;

export const SHIBATI_FACTS = {
  name: '十八梯',
  from: '较场口',
  to: '厚慈街',
  lengthM: 400,
  descentRangeM: [60, 70],
  stepsLabel: '200+',
  platforms: 18,
  source: 'https://www.cq.gov.cn/ywdt/zwhd/qxdt/202109/t20210923_9745036.html'
};

export const HONGYADONG_FACTS = {
  name: '洪崖洞',
  floors: 11,
  // Public descriptions range 75-79 m; the model itself was built from the 79 m
  // archive figure, so the panel reports both instead of merging them.
  heightM: 75,
  modelHeightM: 79,
  entrances: [1, 4, 11],
  source: 'https://zfcxjw.cq.gov.cn/cqcjdag/csjy/202504/t20250416_14526589.html'
};

export const CHAOTIANMEN_FACTS = {
  name: '朝天门长坡',
  from: '解放碑',
  to: '朝天门码头',
  // Street length from 解放碑 down to the river landing, by the mapped corridor.
  lengthM: 1600,
  // Public sources put the drop at roughly 70-80 m; the model's 80 m grid lands
  // near 100 m because it keeps the ridge higher. Both are shown side by side.
  dropRangeM: [70, 80]
};

export const SEGMENT_STYLE = {
  steps: { color: '#f97316', label: '阶梯' },
  ramp: { color: '#facc15', label: '坡道' },
  flat: { color: '#22d3ee', label: '平路' }
};

const gradeBetween = (a, b, scale) => (b.d - a.d) > 1e-6
  ? ((b.y - a.y) * scale) / (b.d - a.d)
  : 0;

export function classifyGrade(grade) {
  const g = Math.abs(grade);
  if (g >= 0.14) return 'steps';
  if (g >= 0.035) return 'ramp';
  return 'flat';
}

// An OSM steps way stays stairs even where the coarse terrain grid flattens it;
// a street becomes stairs only when it is steeper than any street would be.
export function legKind(grade, osmKind = 'street') {
  if (osmKind === 'steps') return Math.abs(grade) < 0.02 ? 'flat' : 'steps';
  return classifyGrade(grade);
}

// Sample a 2D waypoint list at a fixed spacing, taking the ground height from heightAt.
export function resamplePolyline(waypoints, { spacing = 1.5, scale = MODEL_SCALE, heightAt } = {}) {
  if (typeof heightAt !== 'function') throw new Error('resamplePolyline needs heightAt');
  const step = spacing / scale;
  const first = waypoints[0];
  const samples = [{ x: first.x, z: first.z, y: heightAt(first.x, first.z), d: 0, kind: 'flat', label: first.label ?? '' }];
  let distance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1], b = waypoints[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (!length) continue;
    const divisions = Math.max(1, Math.ceil(length / step));
    const kind = b.kind ?? 'street';
    const label = b.label ?? a.label ?? '';
    for (let k = 1; k <= divisions; k++) {
      const t = k / divisions;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      distance += (length * scale) / divisions;
      samples.push({ x, z, y: heightAt(x, z), d: distance, kind, label });
    }
  }
  return samples;
}

// Same, for a path whose heights are already known (the Hongyadong facade zigzag).
export function resamplePath3D(waypoints, { spacing = 1.5, scale = MODEL_SCALE } = {}) {
  const step = spacing / scale;
  const first = waypoints[0];
  const samples = [{ ...first, kind: first.kind ?? 'steps', d: 0 }];
  let distance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1], b = waypoints[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (!length) continue;
    const divisions = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k <= divisions; k++) {
      const t = k / divisions;
      distance += (length * scale) / divisions;
      samples.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        d: distance,
        kind: b.kind ?? a.kind ?? 'steps',
        label: b.label ?? a.label ?? ''
      });
    }
  }
  return samples;
}

// The SRTM grid is ~80 m, so per-sample heights wobble; average them out for the
// profile and the grade classification. The 3D line uses the same smoothed heights.
export function smoothProfile(samples, { windowM = 12 } = {}) {
  if (samples.length < 3) return samples.map(sample => ({ ...sample }));
  const spacing = Math.max(0.1, (samples[samples.length - 1].d - samples[0].d) / (samples.length - 1));
  const half = Math.max(1, Math.round(windowM / spacing));
  return samples.map((sample, index) => {
    let sum = 0, count = 0;
    for (let k = Math.max(0, index - half); k <= Math.min(samples.length - 1, index + half); k++) {
      sum += samples[k].y;
      count++;
    }
    return { ...sample, y: sum / count };
  });
}

function buildRuns(samples) {
  const runs = [];
  samples.forEach((sample, index) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === sample.kind) last.end = index;
    else runs.push({ kind: sample.kind, start: index, end: index });
  });
  return runs;
}

// Classify every sample and merge runs shorter than minRun so the colours read as
// flights of stairs rather than a flicker.
export function classifySamples(samples, { scale = MODEL_SCALE, minRun = 5 } = {}) {
  const graded = samples.map((sample, index) => {
    const a = samples[Math.max(0, index - 1)];
    const b = samples[Math.min(samples.length - 1, index + 1)];
    const grade = gradeBetween(a, b, scale);
    return { ...sample, grade, kind: legKind(grade, sample.kind) };
  });
  let runs = buildRuns(graded);
  for (let pass = 0; pass < 3; pass++) {
    let mutated = false;
    for (let i = 0; i < runs.length; i++) {
      if (runs.length < 2 || runs[i].end - runs[i].start + 1 >= minRun) continue;
      const target = i === 0 ? runs[1] : runs[i - 1];
      for (let k = runs[i].start; k <= runs[i].end; k++) graded[k].kind = target.kind;
      mutated = true;
    }
    if (!mutated) break;
    runs = buildRuns(graded);
  }
  return { samples: graded, runs };
}

export function summarizeRoute(samples, { scale = MODEL_SCALE } = {}) {
  let distance = 0, ascent = 0, descent = 0, maxGrade = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const run = Math.hypot(b.x - a.x, b.z - a.z) * scale;
    const rise = (b.y - a.y) * scale;
    distance += Math.hypot(run, rise);
    if (rise > 0) ascent += rise;
    else descent -= rise;
    if (run > 0.4) maxGrade = Math.max(maxGrade, Math.abs(rise) / run);
  }
  return { distance, ascent, descent, maxGrade };
}

export function estimateSteps(rise, riser = STEP_RISER_M) {
  return Math.max(0, Math.round(Math.abs(rise) / riser));
}

export function pointAt(samples, distance) {
  if (!samples.length) return null;
  const total = samples[samples.length - 1].d;
  const target = Math.min(Math.max(0, distance), total);
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].d <= target) lo = mid;
    else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const span = b.d - a.d;
  const t = span > 1e-6 ? (target - a.d) / span : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    d: target,
    kind: t > 0.5 ? b.kind : a.kind
  };
}

// Split the route into flights between the published number of landings.
export function splitFlights(samples, platforms, { scale = MODEL_SCALE, riser = STEP_RISER_M } = {}) {
  const total = samples[samples.length - 1].d;
  const flights = [];
  const span = total / Math.max(1, platforms - 1);
  for (let i = 0; i < platforms - 1; i++) {
    const start = i * span;
    const end = (i + 1) * span;
    const a = pointAt(samples, start), b = pointAt(samples, end);
    const rise = (b.y - a.y) * scale;
    flights.push({ index: i, start, end, rise, run: span, steps: estimateSteps(rise, riser) });
  }
  return flights;
}

export function sampleProfile(samples, count = 40, { scale = MODEL_SCALE, datum = 0 } = {}) {
  const total = samples[samples.length - 1].d;
  const out = [];
  for (let i = 0; i < count; i++) {
    const point = pointAt(samples, total * i / (count - 1));
    out.push({ d: point.d, h: point.y * scale + datum, kind: point.kind });
  }
  return out;
}

export function clampFloor(level, floors = HONGYADONG_FACTS.floors) {
  return Math.min(floors, Math.max(1, Math.round(level)));
}

export function floorElevation(level, { baseY = 0, floorHeight }) {
  return baseY + (clampFloor(level) - 1) * floorHeight;
}

// Which floor the marker is on, given the route distance where each floor starts.
export function floorAtDistance(floorStarts, distance) {
  let level = 1;
  for (const floor of floorStarts) if (distance >= floor.d) level = floor.level;
  return level;
}

// The demo's mode machine, kept pure so the transitions can be tested without a DOM.
// browse -> overview (card picked, camera framing only) -> playing (user pressed 开始演示)
// back() returns to browse but stays in navigation mode; exit() leaves it.
export const NAV_MODES = ['browse', 'overview', 'playing'];

export function createNavState() {
  return { mode: 'browse', routeId: null, playing: false, started: false, navActive: false, d: 0 };
}

export function navTransition(state, action) {
  const next = { ...state };
  switch (action.type) {
    case 'select':
      next.mode = 'overview';
      next.routeId = action.id;
      next.playing = false;
      next.started = false;
      next.navActive = true;
      next.d = 0;
      break;
    case 'play':
      if (next.mode === 'browse') break;
      if (next.d >= (action.length ?? Infinity) - 0.01) next.d = 0;
      next.mode = 'playing';
      next.playing = true;
      next.started = true;
      break;
    case 'pause':
      next.playing = false;
      break;
    case 'back':
      next.mode = 'browse';
      next.playing = false;
      next.routeId = null;
      next.started = false;
      next.d = 0;
      break;
    case 'exit':
      next.mode = 'browse';
      next.playing = false;
      next.routeId = null;
      next.started = false;
      next.navActive = false;
      next.d = 0;
      break;
    case 'tick':
      if (!next.playing) break;
      next.d = Math.min(action.length ?? next.d, next.d + action.delta);
      if (next.d >= (action.length ?? Infinity)) next.playing = false;
      break;
  }
  return next;
}
