import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import {
  MODEL_SCALE, STEP_RISER_M, SHIBATI_FACTS, HONGYADONG_FACTS, CHAOTIANMEN_FACTS, SEGMENT_STYLE,
  resamplePolyline, resamplePath3D, smoothProfile, classifySamples, summarizeRoute,
  splitFlights, sampleProfile, pointAt, clampFloor, floorAtDistance, createNavState, navTransition
} from './nav-model.js';

// Waypoints follow the mapped stair ways inside the 十八梯 quarter:
// 312090245 (十八梯), 1017606329/30 (北入口), 1017606338 (月台坝), 1017610350 (厚慈街).
// Positions are map geometry; heights come from the model's terrain sampler.
const SHIBATI_WAYPOINTS = [
  { x: -147.0, z: 146.2, label: '较场口' },
  { x: -151.9, z: 147.2, kind: 'steps', label: '十八梯北入口' },
  { x: -155.8, z: 147.3, kind: 'steps', label: '十八梯北入口' },
  { x: -156.4, z: 150.6, kind: 'steps', label: '十八梯' },
  { x: -157.6, z: 154.6, kind: 'steps', label: '十八梯主梯段' },
  { x: -159.7, z: 160.4, kind: 'street', label: '十八梯' },
  { x: -161.4, z: 165.0, kind: 'steps', label: '十八梯下段' },
  { x: -163.1, z: 167.4, kind: 'steps', label: '厚慈街口' },
  { x: -168.0, z: 168.6, kind: 'street', label: '厚慈街' }
];

const FLOOR_TAGS = [1, 4, 11];

// 解放碑 → 邹容路 → 新华路 → 朝天门广场 → 码头梯道. The three anchors are mapped
// points; the rest interpolate along the street corridor (OSM ways 589450449,
// 1413835647, 59146676, 1189963551, 1300942275, 176283804, 1526703962, and the
// landing steps 1430569071 / 1430569088 / 831047011 / 1446711958 / 1446711957).
const CHAOTIANMEN_WAYPOINTS = [
  { x: -124.5, z: 105.7, label: '解放碑' },
  { x: -112.0, z: 108.5, kind: 'street', label: '邹容路' },
  { x: -106.0, z: 110.0, kind: 'street', label: '邹容路' },
  { x: -95.1, z: 111.6, kind: 'street', label: '新华路' },
  { x: -90.0, z: 108.0, kind: 'street', label: '新华路' },
  { x: -85.0, z: 102.0, kind: 'street', label: '新华路' },
  { x: -80.0, z: 95.0, kind: 'street', label: '新华路' },
  { x: -75.0, z: 86.0, kind: 'street', label: '新华路' },
  { x: -64.0, z: 65.0, kind: 'street', label: '朝天门转盘' },
  { x: -50.7, z: 43.5, kind: 'street', label: '朝天门广场' },
  { x: -46.0, z: 38.0, kind: 'steps', label: '码头梯道' },
  { x: -42.0, z: 33.0, kind: 'steps', label: '码头梯道' },
  { x: -37.0, z: 27.0, kind: 'steps', label: '码头梯道' },
  { x: -32.0, z: 22.0, kind: 'steps', label: '码头梯道' },
  { x: -28.0, z: 18.0, kind: 'steps', label: '码头梯道' },
  { x: -26.0, z: 16.0, kind: 'steps', label: '朝天门码头' }
];

// Exported for tests: the facade zigzag in world units, floor by floor.
export function buildHongyadongSamples({ base, floorHeight, floors, scale = MODEL_SCALE }) {
  const widthAt = level => (145 - Math.max(0, level - 5) * 10) / scale;
  const depthAt = level => (22 + level * 1.8) / scale;
  // The group is rotated by PI: local +x/+z become world -x/-z.
  const toWorld = (x, y, z) => ({ x: base.x - x, y: base.y + y, z: base.z - z });
  const levelY = level => (level + 0.15) * floorHeight;

  const waypoints = [];
  const floorStarts = [];
  let travelled = 0;
  let previous = null;
  for (let level = 0; level < floors; level++) {
    const width = widthAt(level);
    const depth = depthAt(level);
    const y = levelY(level);
    const z = depth / 2 + level * 0.18 + 0.34;
    const side = level % 2 === 0 ? -1 : 1;
    let floorStart = 0;
    [-side * width * 0.12, side * width * 0.12].forEach((x, index) => {
      const world = toWorld(x, y, z);
      if (previous) travelled += Math.hypot(world.x - previous.x, world.y - previous.y, world.z - previous.z) * scale;
      waypoints.push({ ...world, kind: 'steps', label: `${level + 1}F` });
      if (index === 0) floorStart = travelled;
      previous = world;
    });
    floorStarts.push({ level: level + 1, d: floorStart });
  }
  return {
    samples: resamplePath3D(waypoints, { spacing: 0.8, scale }),
    floorStarts,
    length: travelled,
    widthAt,
    depthAt,
    levelY,
    toWorld
  };
}

// Exported so the route can be checked against the real terrain grid in tests.
export function buildShibatiSamples({ heightAt, scale = MODEL_SCALE }) {
  const raw = resamplePolyline(SHIBATI_WAYPOINTS, { spacing: 1.5, scale, heightAt });
  const smoothed = smoothProfile(raw, { windowM: 12 });
  const { samples, runs } = classifySamples(smoothed, { scale, minRun: 5 });
  const stats = summarizeRoute(samples, { scale });
  const flights = splitFlights(samples, SHIBATI_FACTS.platforms, { scale });
  const totalSteps = flights.reduce((sum, flight) => sum + flight.steps, 0);
  return { samples, runs, stats, flights, totalSteps };
}

// A 1.6 km street route: the SRTM grid throws spikes along the ridge, so the profile
// is smoothed over 36 m, wider than 十八梯's 12 m.
export function buildChaotianmenSamples({ heightAt, scale = MODEL_SCALE }) {
  const raw = resamplePolyline(CHAOTIANMEN_WAYPOINTS, { spacing: 2, scale, heightAt });
  const smoothed = smoothProfile(raw, { windowM: 36 });
  const { samples, runs } = classifySamples(smoothed, { scale, minRun: 8 });
  const stats = summarizeRoute(samples, { scale });
  const netDropM = (samples[0].y - samples[samples.length - 1].y) * scale;
  return { samples, runs, stats, netDropM };
}

const hex = kind => SEGMENT_STYLE[kind]?.color ?? SEGMENT_STYLE.flat.color;

function makeLabel(text, { color = '#f8fafc', background = 'rgba(8,15,28,0.92)', border = 'rgba(255,255,255,0.45)' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 46px "Noto Sans SC", "PingFang SC", sans-serif';
  const textWidth = Math.min(430, ctx.measureText(text).width);
  const boxWidth = textWidth + 54;
  const left = (512 - boxWidth) / 2;
  ctx.fillStyle = background;
  ctx.strokeStyle = border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(left, 24, boxWidth, 80, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${textWidth > 380 ? 38 : 46}px "Noto Sans SC", "PingFang SC", sans-serif`;
  ctx.fillText(text, 256, 66, 430);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.renderOrder = 8;
  return sprite;
}

// Short rungs across the stair legs. One rung per few steps: at 1.4 px per metre a
// true riser cadence would alias into a solid line, so the rhythm is sampled.
function addStairTicks(group, samples, { spacing = 3.4, width = 1.25, lift = 0.46, onTop = false } = {}) {
  const placements = [];
  let last = -Infinity;
  for (let i = 1; i < samples.length - 1; i++) {
    const sample = samples[i];
    if (sample.kind !== 'steps' || sample.d - last < spacing) continue;
    last = sample.d;
    const a = samples[i - 1], b = samples[i + 1];
    placements.push({ x: sample.x, y: sample.y + lift, z: sample.z, angle: Math.atan2(b.x - a.x, b.z - a.z) });
  }
  if (!placements.length) return null;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.02, 0.07),
    new THREE.MeshBasicMaterial({ color: 0xfff7ed, toneMapped: false, depthTest: !onTop, depthWrite: !onTop, transparent: onTop }),
    placements.length
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  placements.forEach((tick, index) => {
    euler.set(0, tick.angle, 0);
    quaternion.setFromEuler(euler);
    position.set(tick.x, tick.y, tick.z);
    scale.set(width, 1, 1);
    mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = 6;
  group.add(mesh);
  return mesh;
}

// One disc per published landing so "18 个平台" is countable in the scene.
function addPlatformMarks(group, samples, span, { platforms = 18 } = {}) {
  const marks = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x67e8f9, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    depthWrite: false, depthTest: false, toneMapped: false
  });
  for (let i = 0; i < platforms; i++) {
    const point = pointAt(samples, i * span);
    if (!point) continue;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.56, 26), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(point.x, point.y + 0.04, point.z);
    ring.renderOrder = 5;
    marks.add(ring);
  }
  group.add(marks);
  return marks;
}

// A six-sided tube keeps the line readable edge-on (a flat ribbon disappears in a
// side view) and carries the segment colour per vertex. A solid tint draws the
// dark casing that keeps the route readable against pale terrain.
function buildTube(samples, radius, { opacity = 1, additive = false, solidColor = null, onTop = false } = {}) {
  const sides = 6;
  const positions = [];
  const colors = [];
  const indices = [];
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  samples.forEach((sample, index) => {
    const a = samples[Math.max(0, index - 1)];
    const b = samples[Math.min(samples.length - 1, index + 1)];
    tangent.set(b.x - a.x, b.y - a.y, b.z - a.z);
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
    tangent.normalize();
    side.crossVectors(tangent, up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    normal.crossVectors(side, tangent).normalize();
    tint.set(solidColor ?? hex(sample.kind));
    for (let k = 0; k < sides; k++) {
      const angle = (k / sides) * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      positions.push(
        sample.x + (side.x * cos + normal.x * sin) * radius,
        sample.y + (side.y * cos + normal.y * sin) * radius,
        sample.z + (side.z * cos + normal.z * sin) * radius
      );
      colors.push(tint.r, tint.g, tint.b);
    }
  });
  for (let i = 1; i < samples.length; i++) {
    for (let k = 0; k < sides; k++) {
      const next = (k + 1) % sides;
      const a = (i - 1) * sides + k;
      const b = (i - 1) * sides + next;
      const c = i * sides + k;
      const d = i * sides + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: opacity < 1 || onTop,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: opacity >= 1 && !onTop,
    depthTest: !onTop,
    toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const mesh = new THREE.Mesh(geometry, material);
  if (onTop) mesh.renderOrder = 5;
  return mesh;
}

// A dashed trace on the ground: the ribbon floats so the line stays readable, and this
// trace is the part that actually sits in the street and is hidden by the blocks.
function buildGroundTrace(samples, { color = 0x0b1220, opacity = 0.6 } = {}) {
  const points = samples.map(sample => new THREE.Vector3(sample.x, sample.y + 0.06, sample.z));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({ color, dashSize: 1.1, gapSize: 1.1, transparent: true, opacity, depthWrite: false, toneMapped: false })
  );
  line.computeLineDistances();
  return line;
}

// A short light column marking a key point on a long route.
function buildBeacon(color = 0x67e8f9) {
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, toneMapped: false })
  );
  beam.position.y = 0.85;
  beam.renderOrder = 8;
  return beam;
}

function buildMarker() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 18, 14),
    new THREE.MeshBasicMaterial({
      color: 0x67e8f9, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    })
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.86, 44),
    new THREE.MeshBasicMaterial({
      color: 0x67e8f9, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      depthWrite: false, depthTest: false, toneMapped: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.14;
  ring.renderOrder = 9;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8),
    new THREE.MeshBasicMaterial({
      color: 0x67e8f9, transparent: true, opacity: 0.6,
      depthWrite: false, depthTest: false, toneMapped: false
    })
  );
  beam.position.y = 1.05;
  beam.renderOrder = 9;
  group.add(core, halo, ring, beam);
  group.userData.halo = halo;
  group.renderOrder = 9;
  return group;
}

// Frame the route's own samples from its side, not the whole district. The pose is
// measured by projecting the real samples, so the near end of a 400 m route cannot
// spill under the panel the way a bounding-sphere estimate does.
// yaw swings the camera toward the route axis: the horizontal run foreshortens while
// the drop keeps its height, so a 400 m route with a 40 m fall reads as a slope and
// not as a flat line. 0 would be a pure side view.
function frameRoutePose(samples, {
  camera, desiredX = -0.36, targetWidth = 1.06, targetHeight = 0.8,
  yaw = 0.62, elevation = 0.34
} = {}) {
  const xs = samples.map(sample => sample.x);
  const ys = samples.map(sample => sample.y);
  const zs = samples.map(sample => sample.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const centre = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);

  const dx = samples[samples.length - 1].x - samples[0].x;
  const dz = samples[samples.length - 1].z - samples[0].z;
  const length = Math.hypot(dx, dz) || 1;
  const forward = new THREE.Vector3(dx / length, 0, dz / length);
  // Camera sits on the (dz, -dx) side of the route; for 十八梯 that is south-east.
  const side = new THREE.Vector3(forward.z, 0, -forward.x);
  const eye = side.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(forward, Math.sin(yaw));
  eye.y = Math.tan(elevation) * eye.length();
  eye.normalize();
  const right = new THREE.Vector3().crossVectors(eye.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
  const height = Math.max(0.5, maxY - minY);
  const radius = 0.5 * Math.hypot(maxX - minX, height, maxZ - minZ);

  const vfov = THREE.MathUtils.degToRad(camera.fov ?? 36);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (camera.aspect || 1.6));
  const probe = camera.clone();
  const target = centre.clone();
  const position = new THREE.Vector3();
  let distance = radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.05;

  for (let pass = 0; pass < 3; pass++) {
    position.copy(centre).addScaledVector(eye, distance);
    probe.position.copy(position);
    probe.lookAt(target);
    probe.updateMatrixWorld();

    let loX = 1, hiX = -1, loY = 1, hiY = -1;
    for (const sample of samples) {
      const ndc = new THREE.Vector3(sample.x, sample.y, sample.z).project(probe);
      loX = Math.min(loX, ndc.x); hiX = Math.max(hiX, ndc.x);
      loY = Math.min(loY, ndc.y); hiY = Math.max(hiY, ndc.y);
    }
    const scale = Math.max((hiX - loX) / targetWidth, (hiY - loY) / targetHeight);
    distance *= THREE.MathUtils.clamp(scale, 0.5, 2);
  }

  // Final horizontal placement: translate camera and target together along screen-right.
  position.copy(centre).addScaledVector(eye, distance);
  target.y = centre.y + height * 0.1;
  probe.position.copy(position);
  probe.lookAt(target);
  probe.updateMatrixWorld();
  let loX = 1, hiX = -1;
  for (const sample of samples) {
    const ndc = new THREE.Vector3(sample.x, sample.y, sample.z).project(probe);
    loX = Math.min(loX, ndc.x); hiX = Math.max(hiX, ndc.x);
  }
  const shift = (desiredX - (loX + hiX) / 2) * distance * Math.tan(hfov / 2);
  position.addScaledVector(right, -shift);
  target.addScaledVector(right, -shift);
  return { pos: position, target };
}

// Frame the whole facade from the river side: the model's front faces world -z.
// Distance is solved from both the vertical and horizontal spans so 1F and 11F
// stay in shot; the camera then steps sideways for a three-quarter view.
export function frameFacadePose({ base, floorHeight, floors, width, depth, camera, shift = 0.14, margin = 2.05 }) {
  const height = floors * floorHeight;
  const centre = new THREE.Vector3(base.x, base.y + height * 0.5, base.z - depth / 2 - 0.34);
  const vfov = THREE.MathUtils.degToRad(camera.fov ?? 36);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (camera.aspect || 1.6));
  const distance = Math.max(
    height / (2 * Math.tan(vfov / 2)),
    width / (2 * Math.tan(hfov / 2))
  ) * margin;

  // A three-quarter view: the near side wall shows, so the terraces read as a stack of
  // floors rather than as a flat elevation drawing.
  const position = new THREE.Vector3(
    centre.x + width * 0.62,
    base.y + height * 0.62,
    centre.z - distance * 0.86
  );
  const target = centre.clone();
  // Slide the subject left of centre so the open control panel does not cover it.
  const offset = distance * Math.tan(hfov / 2) * shift * 2;
  position.x -= offset;
  target.x -= offset;
  return { pos: position, target };
}

function profileSvg(profile, { footLabel }) {
  const W = 252, H = 78;
  const pad = { l: 30, r: 8, t: 8, b: 15 };
  const heights = profile.map(point => point.h);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const span = Math.max(0.5, max - min);
  const total = profile[profile.length - 1].d || 1;
  const X = d => pad.l + (d / total) * (W - pad.l - pad.r);
  const Y = h => pad.t + (1 - (h - min) / span) * (H - pad.t - pad.b);
  const base = H - pad.b;

  const groups = [];
  profile.forEach((point, index) => {
    const last = groups[groups.length - 1];
    if (last && last.kind === point.kind) last.points.push(point);
    else groups.push({ kind: point.kind, points: [profile[Math.max(0, index - 1)], point] });
  });
  const lines = groups.map(group => {
    const points = group.points.map(point => `${X(point.d).toFixed(1)},${Y(point.h).toFixed(1)}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${hex(group.kind)}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  const area = `M${X(profile[0].d).toFixed(1)},${base} L${profile.map(point => `${X(point.d).toFixed(1)},${Y(point.h).toFixed(1)}`).join(' L')} L${X(total).toFixed(1)},${base} Z`;
  const grid = [0.25, 0.5, 0.75].map(fraction => {
    const y = pad.t + fraction * (H - pad.t - pad.b);
    return `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.12" stroke-width="1"/>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="坡度与高程剖面">
    <defs><linearGradient id="nav-area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#nav-area)"/>
    ${lines}
    <text x="${pad.l - 5}" y="${(Y(max) + 3).toFixed(1)}" text-anchor="end" class="nav-axis">${Math.round(max)}</text>
    <text x="${pad.l - 5}" y="${(Y(min) + 3).toFixed(1)}" text-anchor="end" class="nav-axis">${Math.round(min)}</text>
    <text x="${W - pad.r}" y="${H - 4}" text-anchor="end" class="nav-axis">${footLabel}</text>
  </svg>`;
}

export function createNavigationDemo({ scene, camera, controls, district, cameraTweens, stopCameraMotion }) {
  const scale = district.data.meta.metersPerUnit ?? MODEL_SCALE;
  const heightAt = district.heightAt;
  const ui = {
    cards: [...document.querySelectorAll('.nav-card')],
    live: document.getElementById('nav-live'),
    name: document.getElementById('nav-route-name'),
    sub: document.getElementById('nav-route-sub'),
    cue: document.getElementById('nav-cue'),
    floorNow: document.getElementById('nav-floor-now'),
    stats: document.getElementById('nav-stats'),
    statsLabel: document.getElementById('nav-stats-label'),
    chart: document.getElementById('nav-chart'),
    floors: document.getElementById('nav-floors'),
    progress: document.getElementById('nav-progress-fill'),
    play: document.getElementById('nav-play'),
    back: document.getElementById('nav-back'),
    exit: document.getElementById('nav-exit'),
    note: document.getElementById('nav-note'),
    hud: document.getElementById('nav-hud'),
    hudName: document.getElementById('nav-hud-name'),
    hudCue: document.getElementById('nav-hud-cue'),
    hudFill: document.getElementById('nav-hud-fill'),
    hudRemaining: document.getElementById('nav-hud-remaining'),
    hudPlay: document.getElementById('nav-hud-play'),
    hudBack: document.getElementById('nav-hud-back'),
    hudExit: document.getElementById('nav-hud-exit'),
    detail: document.getElementById('nav-detail')
  };
  if (!ui.live || !ui.cards.length) return null;

  const routes = { shibati: buildShibati(), hongyadong: buildHongyadong(), chaotianmen: buildChaotianmen() };
  const state = {
    ...createNavState(), route: null, saved: null,
    lastMarker: new THREE.Vector3(), follow: false, clock: 0
  };

  Object.values(routes).forEach(route => {
    route.group.visible = false;
    scene.add(route.group);
  });

  function buildShibati() {
    const { samples, runs, stats, flights, totalSteps } = buildShibatiSamples({ heightAt, scale });
    const lift = 0.08;
    const drawn = samples.map(sample => ({ ...sample, y: sample.y + lift }));

    const group = new THREE.Group();
    group.name = '导航演示 · 十八梯';
    // Dark casing + saturated core + soft glow: the route must read from a wide shot.
    // A 400 m route in a 960 px frame is only ~1 px per 0.5 m, so the tube is sized
    // to the screen, not to the street.
    group.add(buildTube(drawn, 0.42, { solidColor: '#0f172a' }));
    group.add(buildTube(drawn, 0.3));
    group.add(buildTube(drawn, 0.62, { opacity: 0.26, additive: true }));

    const span = drawn[drawn.length - 1].d / (SHIBATI_FACTS.platforms - 1);
    addStairTicks(group, drawn);
    addPlatformMarks(group, drawn, span, { platforms: SHIBATI_FACTS.platforms });

    const start = drawn[0], end = drawn[drawn.length - 1];
    const stairRun = runs
      .filter(run => run.kind === 'steps')
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    const stairMid = stairRun
      ? pointAt(drawn, (drawn[stairRun.start].d + drawn[stairRun.end].d) / 2)
      : pointAt(drawn, drawn[drawn.length - 1].d * 0.45);
    const startLabel = makeLabel('较场口 · 起点');
    startLabel.scale.set(3.3, 0.82, 1);
    startLabel.position.set(start.x, start.y + 1.35, start.z);
    const endLabel = makeLabel(`厚慈街 · 第${SHIBATI_FACTS.platforms}平台`);
    endLabel.scale.set(3.3, 0.82, 1);
    endLabel.position.set(end.x, end.y + 1.35, end.z);
    const midLabel = makeLabel('十八梯 · 主梯段', { background: 'rgba(249,115,22,0.94)', color: '#fff7ed', border: 'rgba(255,255,255,0.35)' });
    midLabel.scale.set(3.0, 0.75, 1);
    midLabel.position.set(stairMid.x, stairMid.y + 1.05, stairMid.z);
    group.add(startLabel, endLabel, midLabel);
    // Secondary labels are unreadable (and collide with rooflines) from the wide shot.
    const secondaryLabels = [{ sprite: midLabel, far: 34 }];

    // Landing numbers at the platforms a viewer can actually pick out.
    [6, 12].forEach(platform => {
      const point = pointAt(drawn, (platform - 1) * span);
      if (!point) return;
      const tag = makeLabel(`第 ${platform} 平台`, { background: 'rgba(8,47,73,0.92)', color: '#e0f2fe', border: 'rgba(103,232,249,0.6)' });
      tag.scale.set(2.1, 0.53, 1);
      tag.position.set(point.x, point.y + 0.85, point.z);
      group.add(tag);
      // Key landings stay on screen, just dimmer, so the 18-platform count survives the wide shot.
      secondaryLabels.push({ sprite: tag, far: 40, floor: 0.45 });
    });

    const landing = drawn.find(sample => sample.label === '厚慈街口');
    if (landing) {
      const landingLabel = makeLabel('厚慈街口', { background: 'rgba(250,204,21,0.94)', color: '#422006', border: 'rgba(255,255,255,0.35)' });
      landingLabel.position.set(landing.x, landing.y + 0.9, landing.z);
      landingLabel.scale.set(2.0, 0.5, 1);
      group.add(landingLabel);
      secondaryLabels.push({ sprite: landingLabel, far: 30 });
    }

    const marker = buildMarker();
    marker.position.set(start.x, start.y + 0.05, start.z);
    group.add(marker);

    const datum = 167; // model terrain datum: y = (elevation - 167) / scale

    return {
      id: 'shibati',
      name: SHIBATI_FACTS.name,
      sub: `${SHIBATI_FACTS.from} → ${SHIBATI_FACTS.to} · 约 ${SHIBATI_FACTS.lengthM} m`,
      group, marker, samples: drawn, runs,
      length: drawn[drawn.length - 1].d,
      duration: 44,
      // The whole route is framed, so the camera must not ride along with the marker:
      // following walks the line off the right edge and under the panel.
      followBlend: 0,
      fadeLabels: secondaryLabels,
      profile: sampleProfile(samples, 44, { scale, datum }),
      footLabel: `${Math.round(drawn[drawn.length - 1].d)} m 高程`,
      statsLabel: '模型估算',
      stats: [
        ['距离', `${Math.round(stats.distance)} m`],
        ['下降', `${Math.round(stats.descent)} m`],
        ['爬升', `${Math.round(stats.ascent)} m`],
        ['最大坡度', `${Math.round(stats.maxGrade * 100)}%`],
        ['台阶', `≈ ${totalSteps} 级`],
        ['平台', `${SHIBATI_FACTS.platforms} 个`]
      ],
      note: `资料：约${SHIBATI_FACTS.lengthM} m、${SHIBATI_FACTS.descentRangeM[0]}–${SHIBATI_FACTS.descentRangeM[1]} m 高差、${SHIBATI_FACTS.stepsLabel}级台阶、${SHIBATI_FACTS.platforms}个平台。模型地形为 80 m 网格，梯坎被抹平，估算下降 ${Math.round(stats.descent)} m，小于资料值；台阶按 ${STEP_RISER_M} m 级高推算。路线沿 OSM 十八梯与厚慈街步道走向串联，是演示线，不是完整路网导航。`,
      cue(distance) {
        const index = Math.min(flights.length - 1, Math.floor(distance / span));
        const flight = flights[index];
        const platform = Math.min(SHIBATI_FACTS.platforms, index + 1);
        if (!flight.steps) return `第 ${platform} 个平台 · 平路`;
        return `第 ${platform} 个平台前 · 前方 ${flight.steps} 级台阶`;
      },
      cameraPose: () => frameRoutePose(drawn, { camera })
    };
  }

  function buildHongyadong() {
    const model = district.hongyadongModel;
    const { position: base, floorHeight, floors } = model;
    const built = buildHongyadongSamples({ base, floorHeight, floors, scale });
    const { floorStarts, widthAt, depthAt, levelY, toWorld } = built;
    const { samples: graded, runs } = classifySamples(built.samples, { scale, minRun: 3 });

    const group = new THREE.Group();
    group.name = '导航演示 · 洪崖洞';
    group.add(buildTube(graded, 0.075));
    group.add(buildTube(graded, 0.24, { opacity: 0.16, additive: true }));

    // A very faint volume behind the facade: it gives the terraces a back side, so the
    // floor lines read as a stack of floors rather than as a flat section drawing.
    const volume = new THREE.Mesh(
      new THREE.BoxGeometry(widthAt(0) * 0.98, floors * floorHeight, depthAt(0) * 1.1),
      new THREE.MeshBasicMaterial({
        color: 0x67e8f9, transparent: true, opacity: 0.05,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false
      })
    );
    volume.position.copy(toWorld(0, floors * floorHeight / 2, depthAt(0) / 2));
    group.add(volume);

    const ringMaterials = [];
    for (let level = 0; level < floors; level++) {
      const halfWidth = widthAt(level) / 2 + 0.05;
      const front = depthAt(level) / 2 + level * 0.18 + 0.12;
      const y = levelY(level);
      // A front floor line with short end ticks: annotation, so it ignores depth and
      // stays readable even where the terraces overhang the floor below.
      const points = [
        toWorld(-halfWidth, y, front), toWorld(halfWidth, y, front),
        toWorld(halfWidth, y, front - 0.45), toWorld(halfWidth, y, front),
        toWorld(-halfWidth, y, front), toWorld(-halfWidth, y, front - 0.45)
      ].map(point => new THREE.Vector3(point.x, point.y, point.z));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0x67e8f9, transparent: true, opacity: 0.45, toneMapped: false, depthWrite: false, depthTest: false
      });
      const ring = new THREE.LineSegments(geometry, material);
      ring.renderOrder = 7;
      ringMaterials[level] = material;
      group.add(ring);
    }

    const floorLabels = new Map();
    FLOOR_TAGS.forEach(level => {
      const tag = makeLabel(`${level}F`, { background: 'rgba(4,15,30,0.94)', color: '#ffffff', border: 'rgba(103,232,249,0.8)' });
      const width = widthAt(level - 1) / 2 - 1.1;
      tag.position.copy(toWorld(width, levelY(level - 1), depthAt(level - 1) / 2 + (level - 1) * 0.18 + 0.3));
      tag.scale.set(1.8, 0.64, 1);
      tag.material.depthTest = false;
      tag.material.opacity = 1;
      tag.renderOrder = 9;
      floorLabels.set(level, tag);
      group.add(tag);
    });

    const marker = buildMarker();
    marker.position.copy(toWorld(-widthAt(0) * 0.12, levelY(0), depthAt(0) / 2 + 0.34));
    group.add(marker);

    const totalRise = (floors - 1) * floorHeight * scale;
    const length = graded[graded.length - 1].d;
    const profile = sampleProfile(graded, 44, { scale, datum: -(base.y * scale) });
    const rise = profile[profile.length - 1].h - profile[0].h;

    return {
      id: 'hongyadong',
      name: HONGYADONG_FACTS.name,
      sub: `1F → 4F → 11F · ${floors} 层 · 约 ${HONGYADONG_FACTS.heightM} m`,
      group, marker, samples: graded, runs, length,
      duration: 30,
      followBlend: 0.4,
      profile,
      footLabel: `相对 1F +${rise.toFixed(1)} m`,
      statsLabel: '公开资料 · 模型估算',
      stats: [
        ['距离', `${Math.round(length)} m`],
        ['1F→11F 模型', `${totalRise.toFixed(1)} m`],
        ['楼层', `${floors} 层`],
        ['资料高度', `约 ${HONGYADONG_FACTS.heightM} m`],
        ['入口', '1F / 4F / 11F']
      ],
      floors: floorStarts,
      note: `公开资料：${floors}层、约${HONGYADONG_FACTS.heightM} m（部分档案记${HONGYADONG_FACTS.modelHeightM} m）、1F/4F/11F 多标高入口。楼层高度按模型 ${HONGYADONG_FACTS.modelHeightM}/${floors}≈${(HONGYADONG_FACTS.modelHeightM / floors).toFixed(1)} m 均分，入口位置为模型近似。模型只有临江单立面，不能表示真实的多入口动线；演示线沿立面之字形布置，不代表真实电梯或楼梯位置。`,
      cue(distance) {
        const level = floorAtDistance(floorStarts, distance);
        const entrance = HONGYADONG_FACTS.entrances.includes(level);
        return `洪崖洞 ${level}F · ${entrance ? '入口层' : '观景层'}`;
      },
      setFloor(level) {
        const floor = floorStarts[clampFloor(level, floors) - 1];
        state.d = floor.d;
        placeMarker();
        ringMaterials.forEach((material, index) => {
          const active = index === floor.level - 1;
          material.color.set(active ? 0xf59e0b : 0x67e8f9);
          material.opacity = active ? 1 : 0.32;
        });
        floorLabels.forEach((tag, tagLevel) => {
          const active = tagLevel === floor.level;
          tag.material.color.set(active ? 0xfde68a : 0xffffff);
          tag.material.opacity = active ? 1 : 0.7;
        });
        updateReadout();
      },
      resetFloors() {
        ringMaterials.forEach(material => {
          material.color.set(0x67e8f9);
          material.opacity = 0.45;
        });
        floorLabels.forEach(tag => {
          tag.material.color.set(0xffffff);
          tag.material.opacity = 0.82;
        });
      },
      cameraPose: frameFacadePose({
        base, floorHeight, floors, camera,
        width: widthAt(0), depth: depthAt(0)
      })
    };
  }

  function buildChaotianmen() {
    const { samples, runs, stats, netDropM } = buildChaotianmenSamples({ heightAt, scale });
    const lift = 0.12;
    const drawn = samples.map(sample => ({ ...sample, y: sample.y + lift }));
    // Elevations come from the un-lifted samples: the tube floats 0.12 units up.
    const elev = sample => Math.round(sample.y * scale + 167);
    const startElev = elev(samples[0]), endElev = elev(samples[samples.length - 1]);

    const group = new THREE.Group();
    group.name = '导航演示 · 朝天门';
    // A thin translucent ribbon reads as a route, not as a viaduct: 1.8 km in a 960 px
    // frame is ~4 px per metre, so anything fatter looks like elevated road.
    group.add(buildTube(drawn, 0.34, { solidColor: '#0b1220', opacity: 0.55, onTop: true }));
    group.add(buildTube(drawn, 0.19, { opacity: 0.85, onTop: true }));
    addStairTicks(group, drawn, { spacing: 10, width: 1.5, lift: 0.5, onTop: true });
    group.add(buildGroundTrace(drawn));

    const start = drawn[0], end = drawn[drawn.length - 1];
    const startLabel = makeLabel(`解放碑 · ${startElev} m`);
    startLabel.scale.set(3.6, 0.9, 1);
    startLabel.position.set(start.x, start.y + 1.6, start.z);
    const endLabel = makeLabel(`朝天门码头 · ${endElev} m`);
    endLabel.scale.set(3.6, 0.9, 1);
    endLabel.position.set(end.x, end.y + 1.6, end.z);
    group.add(startLabel, endLabel);

    const fadeLabels = [];
    [['朝天门广场', '朝天门广场'], ['码头梯道', '码头梯道']].forEach(([label, text]) => {
      const sample = drawn.find(item => item.label === label);
      if (!sample) return;
      const tag = makeLabel(text, { background: 'rgba(8,47,73,0.92)', color: '#e0f2fe', border: 'rgba(103,232,249,0.6)' });
      tag.scale.set(2.6, 0.65, 1);
      tag.position.set(sample.x, sample.y + 1.0, sample.z);
      group.add(tag);
      fadeLabels.push({ sprite: tag, far: 62 });
    });

    // Beacons keep the three anchors findable now that the ribbon is thin.
    [start, drawn.find(item => item.label === '朝天门广场'), end].forEach(sample => {
      if (!sample) return;
      const beacon = buildBeacon();
      beacon.position.set(sample.x, sample.y, sample.z);
      group.add(beacon);
    });

    const marker = buildMarker();
    marker.scale.setScalar(1.7);
    marker.position.set(start.x, start.y + 0.05, start.z);
    group.add(marker);

    const labelAt = distance => {
      let lo = 0, hi = drawn.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (drawn[mid].d <= distance) lo = mid; else hi = mid;
      }
      return drawn[lo];
    };

    return {
      id: 'chaotianmen',
      name: CHAOTIANMEN_FACTS.name,
      sub: `${CHAOTIANMEN_FACTS.from} → ${CHAOTIANMEN_FACTS.to} · 约 ${CHAOTIANMEN_FACTS.lengthM} m`,
      group, marker, samples: drawn, runs,
      length: drawn[drawn.length - 1].d,
      duration: 70,
      followBlend: 0.3,
      fadeLabels,
      profile: sampleProfile(samples, 44, { scale, datum: 167 }),
      footLabel: `模型 ${startElev} → ${endElev} m`,
      statsLabel: '模型高程 · 公开资料区间',
      stats: [
        ['距离', `≈ ${Math.round(stats.distance)} m`],
        ['起点高程', `${startElev} m`],
        ['终点高程', `${endElev} m`],
        ['模型净下降', `${Math.round(netDropM)} m`],
        ['资料高差', `${CHAOTIANMEN_FACTS.dropRangeM[0]}–${CHAOTIANMEN_FACTS.dropRangeM[1]} m`],
        ['最大坡度', `${Math.round(stats.maxGrade * 100)}%`]
      ],
      note: `资料口径：解放碑到朝天门约 ${CHAOTIANMEN_FACTS.lengthM} m、高差约 ${CHAOTIANMEN_FACTS.dropRangeM[0]}–${CHAOTIANMEN_FACTS.dropRangeM[1]} m。模型取 80 m 网格高程，起点约 ${startElev} m、码头约 ${endElev} m，净下降 ${Math.round(netDropM)} m，比资料大，两者并列不相加。路线沿解放碑—邹容路—新华路—朝天门广场—码头梯道的街道走向串联，中间点按街道走向插值，是演示线，不是完整路网导航；码头梯道沿用 OSM 步道走向，未虚构台阶数。`,
      cue(distance) {
        const sample = labelAt(distance);
        const remaining = Math.max(0, drawn[drawn.length - 1].d - distance);
        const part = sample.kind === 'steps' ? '梯道下降' : sample.kind === 'ramp' ? '长坡' : '平路';
        return `${sample.label || '朝天门长坡'} · ${part} · 剩余 ${Math.round(remaining)} m`;
      },
      cameraPose: () => frameRoutePose(drawn, {
        camera, yaw: 0.5, elevation: 0.6, targetWidth: 1.05, targetHeight: 0.86, desiredX: -0.3
      })
    };
  }

  function placeMarker() {
    const route = state.route;
    if (!route) return;
    const point = pointAt(route.samples, state.d);
    route.marker.position.set(point.x, point.y + 0.02, point.z);
  }

  function updateReadout() {
    const route = state.route;
    if (!route) return;
    ui.cue.textContent = route.cue(state.d);
    if (ui.floorNow) {
      if (route.floors) {
        const level = floorAtDistance(route.floors, state.d);
        ui.floorNow.hidden = false;
        ui.floorNow.textContent = `${level}F`;
        ui.floors.querySelectorAll('button').forEach(button => {
          button.classList.toggle('active', Number(button.dataset.floor) === level);
        });
      } else {
        ui.floorNow.hidden = true;
      }
    }
    const ratio = route.length ? state.d / route.length : 0;
    const percent = `${(ratio * 100).toFixed(1)}%`;
    const atEnd = state.d >= route.length - 0.01;
    const label = atEnd && state.started ? '重播' : state.playing ? '暂停' : state.started ? '继续' : '开始演示';
    ui.progress.style.width = percent;
    ui.play.textContent = label;
    if (ui.hud) {
      ui.hudName.textContent = route.name;
      ui.hudCue.textContent = ui.cue.textContent;
      ui.hudFill.style.width = percent;
      ui.hudRemaining.textContent = atEnd ? '已到终点' : `剩余 ${Math.round(route.length - state.d)} m`;
      ui.hudPlay.textContent = label;
    }
  }

  function tweenCamera(pose, duration = 1500) {
    if (!cameraTweens) {
      camera.position.copy(pose.pos);
      controls.target.copy(pose.target);
      return;
    }
    new TWEEN.Tween(camera.position, cameraTweens)
      .to(pose.pos, duration)
      .easing(TWEEN.Easing.Cubic.InOut)
      .start();
    new TWEEN.Tween(controls.target, cameraTweens)
      .to(pose.target, duration)
      .easing(TWEEN.Easing.Cubic.InOut)
      .start();
  }

  function apply(action) {
    Object.assign(state, navTransition(state, action));
  }

  // Picking a card only selects the route and frames it: the demo waits for 开始演示.
  function select(id) {
    const route = routes[id];
    if (!route) return;
    stopCameraMotion?.();
    if (!state.saved) state.saved = { pos: camera.position.clone(), target: controls.target.clone() };
    apply({ type: 'select', id });
    document.body.classList.add('nav-active');
    document.body.classList.remove('nav-playing');
    document.getElementById('landmark-tooltip')?.classList.add('hidden');
    Object.values(routes).forEach(other => {
      other.group.visible = other === route;
      if (other.resetFloors) other.resetFloors();
    });
    ui.cards.forEach(card => card.classList.toggle('active', card.dataset.route === id));
    state.route = route;
    state.follow = false;
    ui.live.hidden = false;
    ui.live.classList.remove('is-browse');
    ui.name.textContent = route.name;
    ui.sub.textContent = route.sub;
    ui.stats.innerHTML = route.stats.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    ui.statsLabel.textContent = route.statsLabel ?? '模型估算';
    ui.chart.innerHTML = profileSvg(route.profile, { footLabel: route.footLabel });
    ui.note.textContent = route.note;
    ui.floors.hidden = !route.floors;
    if (route.floors) {
      ui.floors.innerHTML = route.floors.map(floor => `<button type="button" data-floor="${floor.level}">${floor.level}F</button>`).join('');
    }
    placeMarker();
    state.lastMarker.copy(route.marker.position);
    tweenCamera(typeof route.cameraPose === 'function' ? route.cameraPose() : route.cameraPose, 1500);
    updateReadout();
    ui.live.scrollIntoView({ block: 'nearest' });
  }

  // Back to the card list: stays in navigation mode and keeps the camera where it is.
  function back() {
    if (!state.route) return;
    state.route.group.visible = false;
    if (state.route.resetFloors) state.route.resetFloors();
    apply({ type: 'back' });
    state.route = null;
    state.follow = false;
    // The live block stays so 退出 is still reachable; only its actions remain.
    ui.live.hidden = false;
    ui.live.classList.add('is-browse');
    ui.hud.hidden = true;
    ui.detail.hidden = true;
    document.body.classList.remove("nav-panel-peek");
    if (ui.floorNow) ui.floorNow.hidden = true;
    document.body.classList.remove('nav-playing');
    ui.cards.forEach(card => card.classList.remove('active'));
  }

  function exit() {
    if (state.mode === 'browse' && !state.navActive) return;
    if (state.route) {
      state.route.group.visible = false;
      if (state.route.resetFloors) state.route.resetFloors();
    }
    apply({ type: 'exit' });
    state.route = null;
    state.follow = false;
    ui.live.hidden = true;
    ui.live.classList.remove('is-browse');
    ui.hud.hidden = true;
    ui.detail.hidden = true;
    document.body.classList.remove("nav-panel-peek");
    if (ui.floorNow) ui.floorNow.hidden = true;
    document.body.classList.remove('nav-active', 'nav-playing');
    ui.cards.forEach(card => card.classList.remove('active'));
    if (state.saved) {
      tweenCamera(state.saved, 1200);
      state.saved = null;
    }
  }

  function togglePlay() {
    const route = state.route;
    if (!route) return;
    if (state.playing) apply({ type: 'pause' });
    else {
      apply({ type: 'play', length: route.length });
      state.follow = true;
      state.lastMarker.copy(route.marker.position);
    }
    document.body.classList.toggle('nav-playing', state.mode === 'playing');
    ui.hud.hidden = state.mode !== 'playing';
    ui.detail.hidden = state.mode !== 'playing';
    updateReadout();
  }

  ui.detail.addEventListener('click', () => {
    document.body.classList.toggle('nav-panel-peek');
  });

  ui.cards.forEach(card => card.addEventListener('click', () => {
    if (state.playing) return; // the cards must not hijack a running demo
    select(card.dataset.route);
  }));
  ui.exit.addEventListener('click', exit);
  ui.back.addEventListener('click', back);
  ui.play.addEventListener('click', togglePlay);
  ui.hudPlay.addEventListener('click', togglePlay);
  ui.hudBack.addEventListener('click', back);
  ui.hudExit.addEventListener('click', exit);
  ui.floors.addEventListener('click', event => {
    const button = event.target.closest('button[data-floor]');
    if (!button || !state.route?.setFloor) return;
    state.route.setFloor(Number(button.dataset.floor));
    ui.floors.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
  });

  function update(delta) {
    const route = state.route;
    if (!route) return;
    state.clock += delta;
    if (state.playing) {
      apply({ type: 'tick', delta: (route.length / route.duration) * delta, length: route.length });
      placeMarker();
      updateReadout();
    }
    route.marker.userData.halo.scale.setScalar(1 + Math.sin(state.clock * 3.4) * 0.18);
    if (route.fadeLabels) {
      for (const { sprite, far, floor = 0 } of route.fadeLabels) {
        const ramp = THREE.MathUtils.clamp((far - camera.position.distanceTo(sprite.position)) / 6, 0, 1);
        const opacity = floor + (1 - floor) * ramp;
        sprite.material.opacity = opacity;
        sprite.visible = opacity > 0.02;
      }
    }
    if (state.follow) {
      const deltaPosition = route.marker.position.clone().sub(state.lastMarker).multiplyScalar(route.followBlend);
      camera.position.add(deltaPosition);
      controls.target.add(deltaPosition);
    }
    state.lastMarker.copy(route.marker.position);
  }

  return { select, back, exit, update, routes, state };
}
