import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bridgeMember } from './bridge-member.js';

export function buildZengjiayan(scene, district, interactiveObjects, nightMaterials) {
  const scale = district.data.meta.metersPerUnit;
  const routes = district.data.roads.filter(road => road[1] === '曾家岩大桥' && road[3] === 'yes');
  const paths = routes.map(road => {
    const points = road[4].map(([x, z]) => new THREE.Vector3(x, 0, z));
    if (points[0].z > points.at(-1).z) points.reverse();
    const path = new THREE.CurvePath();
    for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1], points[i]));
    return path;
  });
  const centerAt = t => paths.reduce((point, path) => point.add(path.getPoint(t)), new THREE.Vector3()).divideScalar(paths.length);
  const start = centerAt(0), end = centerAt(1);
  const length = paths.reduce((sum, path) => sum + path.getLength(), 0) / paths.length;
  const width = 32.6 / scale;
  // shortcut: deck elevation and member sizes are estimated until as-built sections are available.
  const deckY = Math.max(district.heightAt(start.x, start.z), district.heightAt(end.x, end.z)) + 2;
  const railY = deckY - 9 / scale;
  const group = new THREE.Group();
  group.name = '曾家岩大桥 · 公轨双层钢桁梁';
  const red = new THREE.MeshStandardMaterial({ color: 0xb82f2b, roughness: 0.55, metalness: 0.35 });
  const grey = new THREE.MeshStandardMaterial({ color: 0xc0c5c5, roughness: 0.65, metalness: 0.25 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x848b88, roughness: 1 });
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x4a5055, roughness: 1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe6dfc6, roughness: 0.8 });
  const light = new THREE.MeshStandardMaterial({ color: 0xffd7a0, emissive: 0xffbe70, emissiveIntensity: 0 });
  const parts = new Map([red, grey, concrete, asphalt, white, light].map(material => [material, []]));
  const member = (a, b, thickness, material, breadth = thickness) => {
    parts.get(material).push(bridgeMember(a, b, thickness, breadth));
  };
  const at = (t, offset, y) => {
    const p = centerAt(t);
    const tangent = centerAt(Math.min(1, t + 0.001)).sub(centerAt(Math.max(0, t - 0.001))).normalize();
    return p.set(p.x - tangent.z * offset, y, p.z + tangent.x * offset);
  };
  const divisions = Math.ceil(length * scale / 8);
  for (let i = 0; i < divisions; i++) {
    const a = i / divisions, b = (i + 1) / divisions;
    member(at(a, 0, deckY), at(b, 0, deckY), 0.65 / scale, asphalt, width);
    for (const side of [-1, 1]) {
      member(at(a, side * (width / 2 - 1 / scale), deckY + 0.08),
        at(b, side * (width / 2 - 1 / scale), deckY + 0.08), 0.2 / scale, concrete, 2 / scale);
      member(at(a, side * width / 2, deckY + 1.2 / scale),
        at(b, side * width / 2, deckY + 1.2 / scale), 0.12 / scale, grey);
      member(at(a, side * width / 2, deckY + 0.2 / scale),
        at(b, side * width / 2, deckY + 0.2 / scale), 0.1 / scale, light);
      member(at(a, side * width / 2, deckY), at(a, side * width / 2, deckY + 1.2 / scale), 0.1 / scale, grey);
      for (const rail of [-0.72, 0.72]) {
        member(at(a, (side * 2.5 + rail) / scale, railY),
          at(b, (side * 2.5 + rail) / scale, railY), 0.15 / scale, grey);
      }
    }
    member(at(a, 0, railY - 0.3 / scale), at(b, 0, railY - 0.3 / scale), 0.6 / scale, concrete, 10 / scale);
    for (const offset of [-7, -3.5, 0, 3.5, 7]) {
      if (offset && i % 2) continue;
      member(at(a, offset / scale, deckY + 0.34 / scale), at((a + b) / 2, offset / scale, deckY + 0.34 / scale),
        0.025 / scale, white, 0.15 / scale);
    }
  }
  const mainFraction = Math.min(1, 540 / scale / length);
  const mainStart = (1 - mainFraction) / 2;
  const bridgeT = u => mainStart + mainFraction * u;
  const topY = u => {
    if (u < 0.25) return deckY + 24 / scale * (u / 0.25) ** 2;
    if (u > 0.75) return deckY + 24 / scale * ((1 - u) / 0.25) ** 2;
    return deckY + (2 + 22 * ((u - 0.5) / 0.25) ** 2) / scale;
  };
  for (let i = 0; i < 44; i++) {
    const a = i / 44, b = (i + 1) / 44;
    for (const side of [-1, 1]) {
      const offset = side * (width / 2 - 2.5 / scale);
      member(at(bridgeT(a), offset, topY(a)), at(bridgeT(b), offset, topY(b)), 0.8 / scale, red);
      for (const y of [deckY - 0.6 / scale, railY - 0.8 / scale]) {
        member(at(bridgeT(a), offset, y), at(bridgeT(b), offset, y), 0.7 / scale, red);
      }
      member(at(bridgeT(a), offset, railY), at(bridgeT(a), offset, topY(a)), 0.35 / scale, grey);
      member(at(bridgeT(a), offset, railY), at(bridgeT(b), offset, deckY - 0.6 / scale), 0.35 / scale, grey);
      member(at(bridgeT(a), offset, deckY - 0.6 / scale), at(bridgeT(b), offset, railY), 0.35 / scale, grey);
    }
    member(at(bridgeT(a), -width / 2 + 2.5 / scale, railY - 0.5 / scale),
      at(bridgeT(a), width / 2 - 2.5 / scale, railY - 0.5 / scale), 0.45 / scale, grey);
  }
  for (const u of [0.25, 0.75]) {
    const t = bridgeT(u);
    for (const side of [-1, 1]) {
      const x = side * 7 / scale;
      member(at(t, x, -2), at(t, x, railY - 0.8 / scale), 3.2 / scale, concrete, 4 / scale);
    }
    member(at(t, -width / 2, railY - 1 / scale), at(t, width / 2, railY - 1 / scale), 2 / scale, concrete);
  }
  for (const [material, geometries] of parts) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(part => part.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  nightMaterials.push({ material: light, baseIntensity: 2 });
  group.userData = {
    name: '曾家岩嘉陵江大桥',
    desc: '公轨双层桥，上层双向六车道，下层为轨道交通10号线。主桥按135＋270＋135米三跨关系建模，桥宽32.6米；依据施工报道采用中国红主轮廓和浅灰杆件。桥位取自OSM，桥面高程、杆件截面及墩形为近似，站桥换乘设施仍待细化。',
    source: 'https://www.cq.gov.cn/zwgk/zfxxgkzl/fdzdgknr/zdxm/dtxx/202009/t20200901_8808316.html'
  };
  group.children.forEach(mesh => { mesh.userData = group.userData; interactiveObjects.push(mesh); });
  scene.add(group);
  return at(0.5, 0, deckY);
}
