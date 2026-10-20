import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import lizibaMap from './liziba-tracks.json';

export const QUARTER_SOURCES = {
  huguang: 'https://whlyw.cq.gov.cn/zjwl/yzq/cqwlzy/zqwwzy/202405/t20240507_13182428.html',
  shibati: 'https://www.cqyz.gov.cn/zwgk_229/jytabl/rddbjy/202206/t20220606_10781311.html',
  shibatiRelief: 'https://www.cq.gov.cn/ywdt/zwhd/qxdt/202109/t20210923_9745036.html',
  liziba: 'https://www.cq.gov.cn/zjcq/cycq/jplyxl/dsy/dsjp/202608/t20260826_15982335.html',
  lizibaBuilding: 'https://m.12371.gov.cn/content/2025-09/11/content_498761.html'
};

export function pointInQuarter(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

export function buildQuarters({ group, data, heightAt, project, interactiveObjects, nightMaterials }) {
  const scale = data.meta.metersPerUnit;
  const huguangRing = data.landmarks.find(item => item[0] === 866088553)[2];
  const shibatiRing = data.landmarks.find(item => item[0] === 312090249)[2];
  const excludedBuildings = new Set([lizibaMap.station.buildingId]);
  const geometryBuckets = { yellow: [], white: [], roof: [] };
  const windowGeometry = new THREE.PlaneGeometry(1.1 / scale, 1.3 / scale);
  const windowTransforms = [];
  const transform = new THREE.Object3D();
  const warmWindow = new THREE.MeshStandardMaterial({ color: 0x7e8c84, roughness: 0.5, emissive: 0xffb85e, emissiveIntensity: 0 });
  const ridgeMaterial = new THREE.MeshStandardMaterial({ color: 0x5a5850, roughness: 1 });
  nightMaterials.push({ material: warmWindow, baseIntensity: 1.3 });

  const historicBuildings = [];
  for (const building of data.buildings) {
    const ring = building[4].slice(0, -1);
    const center = ring.reduce((p, [x, z]) => p.add(new THREE.Vector2(x, z)), new THREE.Vector2()).divideScalar(ring.length);
    const huguang = pointInQuarter(center.x, center.y, huguangRing);
    const shibati = pointInQuarter(center.x, center.y, shibatiRing);
    if (!huguang && !shibati) continue;
    excludedBuildings.add(building[0]);
    historicBuildings.push({ id: building[0], ring, center, huguang, height: (building[2] ?? ((building[3] ?? (huguang ? 1.5 : 2.5)) * 3.2)) / scale });
  }
  for (const building of historicBuildings) {
    const { ring, center, huguang, height } = building;
    const ground = ring.map(([x, z]) => heightAt(x, z));
    const floor = Math.max(...ground), foundation = Math.min(...ground) - 0.04;
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const walls = new THREE.ExtrudeGeometry(shape, { depth: floor + height - foundation, bevelEnabled: false });
    walls.rotateX(-Math.PI / 2);
    walls.translate(0, foundation, 0);
    geometryBuckets[huguang ? 'yellow' : 'white'].push(walls);

    let longestEdge = 0, longest = 0;
    const winding = ring.reduce((area, point, index) => {
      const next = ring[(index + 1) % ring.length];
      return area + point[0] * next[1] - next[0] * point[1];
    }, 0) >= 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (length > longest) { longest = length; longestEdge = i; }
      const courses = Math.max(1, Math.round(height * scale / 3.2));
      const count = Math.max(1, Math.floor(length * scale / 2.5));
      if (length * scale < 2) continue;
      const outward = new THREE.Vector2((b[1] - a[1]) * winding, (a[0] - b[0]) * winding).normalize();
      for (let level = 0; level < courses; level++) {
        for (let window = 0; window < count; window++) {
          const t = (window + 0.5) / count;
          transform.position.set(THREE.MathUtils.lerp(a[0], b[0], t) + outward.x * 0.012,
            floor + (level + 0.55) * height / courses, THREE.MathUtils.lerp(a[1], b[1], t) + outward.y * 0.012);
          transform.rotation.set(0, Math.atan2(outward.x, outward.y), 0);
          transform.updateMatrix();
          windowTransforms.push(transform.matrix.clone());
        }
      }
    }
    const roofHeight = Math.min(3.5 / scale, longest * 0.22);
    if (ring.length === 4) {
      const corners = [0, 1, 2, 3].map(offset => {
        const p = ring[(longestEdge + offset) % 4];
        return new THREE.Vector3(p[0], floor + height + 0.025, p[1]);
      });
      const [a, b, c, d] = corners;
      const ridgeA = a.clone().add(d).multiplyScalar(0.5).lerp(b.clone().add(c).multiplyScalar(0.5), 0.12);
      const ridgeB = b.clone().add(c).multiplyScalar(0.5).lerp(a.clone().add(d).multiplyScalar(0.5), 0.12);
      ridgeA.y += roofHeight;
      ridgeB.y += roofHeight;
      const roof = new THREE.BufferGeometry().setFromPoints([a, b, ridgeB, a, ridgeB, ridgeA,
        c, d, ridgeA, c, ridgeA, ridgeB, d, a, ridgeA, b, c, ridgeB]);
      roof.computeVertexNormals();
      geometryBuckets.roof.push(roof);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, ridgeA.distanceTo(ridgeB)), ridgeMaterial);
      ridge.position.copy(ridgeA).add(ridgeB).multiplyScalar(0.5);
      ridge.lookAt(ridgeB);
      group.add(ridge);
    } else {
      const roof = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
      roof.rotateX(-Math.PI / 2);
      roof.translate(0, floor + height, 0);
      geometryBuckets.roof.push(roof);
    }
    if (huguang && ring.length === 4) {
      // Curving firewalls are an exterior approximation, not measured ornamental profiles.
      for (const side of [0, 2]) {
        const a = ring[(longestEdge + side) % 4], b = ring[(longestEdge + side + 3) % 4];
        const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const profile = new THREE.Shape();
        profile.moveTo(0, 0);
        profile.lineTo(width, 0);
        profile.lineTo(width, 0.1);
        profile.quadraticCurveTo(width * 0.78, roofHeight * 0.75, width * 0.5, roofHeight + 0.1);
        profile.quadraticCurveTo(width * 0.22, roofHeight * 0.75, 0, 0.1);
        profile.closePath();
        const firewall = new THREE.ExtrudeGeometry(profile, { depth: 0.07, bevelEnabled: false });
        firewall.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
        firewall.translate(a[0], floor + height, a[1]);
        geometryBuckets.yellow.push(firewall);
      }
    }
  }
  const materials = {
    yellow: new THREE.MeshStandardMaterial({ color: 0xd8b64e, roughness: 0.9 }),
    white: new THREE.MeshStandardMaterial({ color: 0xcfc5b1, roughness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x4f5857, roughness: 0.95, side: THREE.DoubleSide })
  };
  for (const [key, geometries] of Object.entries(geometryBuckets)) {
    if (!geometries.length) continue;
    // Extrusions and procedural roof faces share positions/normals; UVs are unused here.
    geometries.forEach(geometry => { geometry.deleteAttribute('uv'); });
    const merged = mergeGeometries(geometries.map(geometry => geometry.index ? geometry.toNonIndexed() : geometry));
    const mesh = new THREE.Mesh(merged, materials[key]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  const windows = new THREE.InstancedMesh(windowGeometry, warmWindow, windowTransforms.length);
  windowTransforms.forEach((matrix, index) => windows.setMatrixAt(index, matrix));
  group.add(windows);

  const stairMatrices = [];
  const stairGeometry = new THREE.BoxGeometry(1, 1, 1);
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0xb4ac9b, roughness: 1 });
  for (const [, name, kind, , points] of data.roads) {
    if (kind !== 'steps' || !points.some(([x, z]) => pointInQuarter(x, z, shibatiRing))) continue;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const length = Math.hypot(bx - ax, bz - az);
      if (!length) continue;
      const rise = heightAt(bx, bz) - heightAt(ax, az);
      const count = Math.max(1, Math.ceil(length * scale / 0.34), Math.ceil(Math.abs(rise) * scale / 0.18));
      const tread = length / count;
      const stepHeight = Math.max(0.02, Math.abs(rise) / count);
      for (let step = 0; step < count; step++) {
        const t = (step + 0.5) / count;
        const x = THREE.MathUtils.lerp(ax, bx, t), z = THREE.MathUtils.lerp(az, bz, t);
        transform.position.set(x, heightAt(x, z) + 0.12 - stepHeight / 2, z);
        transform.rotation.set(0, Math.atan2(bx - ax, bz - az), 0);
        transform.scale.set(3 / scale, stepHeight, tread * 1.02);
        transform.updateMatrix();
        stairMatrices.push(transform.matrix.clone());
      }
    }
  }
  transform.scale.set(1, 1, 1);
  const stairs = new THREE.InstancedMesh(stairGeometry, stoneMaterial, stairMatrices.length);
  stairMatrices.forEach((matrix, index) => stairs.setMatrixAt(index, matrix));
  stairs.receiveShadow = true;
  group.add(stairs);

  const centerOf = ring => ring.slice(0, -1).reduce((p, [x, z]) => p.add(new THREE.Vector3(x, 0, z)), new THREE.Vector3()).divideScalar(ring.length - 1);
  const huguang = centerOf(huguangRing), shibati = centerOf(shibatiRing);
  huguang.y = heightAt(huguang.x, huguang.z);
  shibati.y = heightAt(shibati.x, shibati.z);
  const landmarkHit = (name, position, size, source, desc) => {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(position);
    hit.position.y += size[1] / 2;
    hit.userData = { name, source, desc };
    group.add(hit);
    interactiveObjects.push(hit);
  };
  landmarkHit('湖广会馆 · 院落与封火墙', huguang, [10, 3, 12], QUARTER_SOURCES.huguang,
    '按地图中31处建筑轮廓构建院落、青瓦屋顶和黄色封火墙。屋高、木雕与墙顶曲线尚为外观近似。');
  landmarkHit('十八梯 · 七街六巷', shibati, [14, 8, 20], QUARTER_SOURCES.shibati,
    '街巷沿地图落位，按地形建立独立踏步；公开报道的约70米高低落差仅作形态参考。建筑高度与具体梯级尺寸仍为估算。');

  // Liziba station and monorail tracks are west of Zengjiayan (x = -425), excluded from the core peninsula diorama
  const liziba = new THREE.Vector3();
  return { excludedBuildings, huguang, shibati, liziba, update: () => {} };
}
