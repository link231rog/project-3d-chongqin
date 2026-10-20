import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import snapshot from './peninsula-snapshot.json';
import parks from './peninsula-parks.json';
import { buildQuarters, QUARTER_SOURCES } from './quarters.js';
import elevationSnapshot from './peninsula-elevation.json';
import { sampleElevation } from './elevation.js';
import { createFacadeAtlas } from './facade-texture.js';

function hash01(n) {
  const value = Math.sin(n * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polygonCentroid(polygon) {
  let twiceArea = 0, x = 0, z = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i];
    const [x2, z2] = polygon[(i + 1) % polygon.length];
    const cross = x1 * z2 - x2 * z1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    z += (z1 + z2) * cross;
  }
  if (Math.abs(twiceArea) < 1e-6) {
    const average = polygon.reduce((sum, [px, pz]) => [sum[0] + px, sum[1] + pz], [0, 0]);
    return { x: average[0] / polygon.length, z: average[1] / polygon.length, area: 0 };
  }
  return { x: x / (3 * twiceArea), z: z / (3 * twiceArea), area: Math.abs(twiceArea) / 2 };
}

export const MODEL_SOURCES = {
  terrain: 'https://www.cqyz.gov.cn/zjyz/yzgk/zrdl/202302/t20230223_11646635.html',
  elevation: 'https://www.opentopodata.org/datasets/srtm/',
  jiefangbei: 'https://dfz.cq.gov.cn/zqlswh/fjms_417821/202311/t20231102_12511619.html',
  auditorium: 'https://www.cqyz.gov.cn/zjyz/lyyz/lswh/lsww/202210/t20221008_11166849.html',
  hongyadong: 'https://zfcxjw.cq.gov.cn/cqcjdag/csjy/202504/t20250416_14526589.html',
  raffles: 'https://www.safdiearchitects.com/projects/raffles-city-chongqing',
  cableway: 'https://www.cqsuodao.com/',
  eling: 'https://mzj.cq.gov.cn/sy_218/bmdt/mzyw/202411/t20241101_13760704.html',
  pipa: 'https://cgj.cq.gov.cn/rdzt/ylsmypcswm/202206/t20220602_10775608.html',
  ...QUARTER_SOURCES
};

export async function buildPeninsula(scene, interactiveObjects, nightMaterials) {
  const decode = async resource => {
    const bytes = Uint8Array.from(atob(resource.data), char => char.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).text());
  };
  const [data, elevation] = await Promise.all([decode(snapshot), decode(elevationSnapshot)]);
  const group = new THREE.Group();
  group.name = '渝中半岛 · 地理底图';
  group.userData.source = { ...data.meta, terrain: elevation };
  const scale = data.meta.metersPerUnit;
  const project = (lon, lat) => new THREE.Vector3(
    (lon - data.meta.origin[0]) * 96800 / scale, 0,
    -(lat - data.meta.origin[1]) * 111320 / scale
  );
  const WEST_LIMIT_X = -361.0;
  // Core peninsula clipping: focus exclusively on the core Yuzhong mother city from Zengjiayan East to Chaotianmen.
  // data.land index 137 is south bank [-360.87, 215.59]; index 205 is north bank [-361.08, 20.56].
  const boundary = [
    ...data.land.slice(137, 206),
    [WEST_LIMIT_X, 20.56],
    [WEST_LIMIT_X, 215.59],
    data.land[137]
  ];
  // A fixed exhibition datum is used for the water; this is not a live river-level model.
  const heightAt = (x, z) => {
    const longitude = data.meta.origin[0] + x * scale / 96800;
    const latitude = data.meta.origin[1] - z * scale / 111320;
    return Math.max(0.7, (sampleElevation(elevation, longitude, latitude) - 167) / scale);
  };
  const landPolygons = [{ outer: boundary, holes: [] }];
  const terrainPositions = [];
  const subdivide = (a, b, c, depth = 0, target = terrainPositions, elevationOffset = 0) => {
    const abLength = a.distanceToSquared(b), bcLength = b.distanceToSquared(c), caLength = c.distanceToSquared(a);
    const longest = Math.max(abLength, bcLength, caLength);
    if (longest > (elevation.stepLatitude * 111320 / scale) ** 2 && depth < 14) {
      if (longest === abLength) {
        const midpoint = a.clone().add(b).multiplyScalar(0.5);
        subdivide(a, midpoint, c, depth + 1, target, elevationOffset);
        subdivide(midpoint, b, c, depth + 1, target, elevationOffset);
      } else if (longest === bcLength) {
        const midpoint = b.clone().add(c).multiplyScalar(0.5);
        subdivide(a, b, midpoint, depth + 1, target, elevationOffset);
        subdivide(a, midpoint, c, depth + 1, target, elevationOffset);
      } else {
        const midpoint = c.clone().add(a).multiplyScalar(0.5);
        subdivide(a, b, midpoint, depth + 1, target, elevationOffset);
        subdivide(midpoint, b, c, depth + 1, target, elevationOffset);
      }
      return;
    }
    for (const p of [a, b, c]) target.push(p.x, heightAt(p.x, -p.y) + elevationOffset, -p.y);
  };
  for (const polygon of landPolygons) {
    const shape = new THREE.Shape(polygon.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = polygon.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    const flat = new THREE.ShapeGeometry(shape).toNonIndexed();
    const positions = flat.getAttribute('position');
    for (let i = 0; i < positions.count; i += 3) {
      subdivide(new THREE.Vector3().fromBufferAttribute(positions, i),
        new THREE.Vector3().fromBufferAttribute(positions, i + 1),
        new THREE.Vector3().fromBufferAttribute(positions, i + 2));
    }
    flat.dispose();
  }
  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(terrainPositions, 3));
  const smoothTerrain = mergeVertices(surfaceGeometry);
  surfaceGeometry.dispose();
  smoothTerrain.computeVertexNormals();
  const surface = new THREE.Mesh(smoothTerrain, new THREE.MeshStandardMaterial({ color: 0xaea79c, roughness: 0.95 }));
  surface.receiveShadow = true;
  group.add(surface);

  const shoreVertices = [];
  for (const polygon of landPolygons) {
    for (const ring of [polygon.outer, ...polygon.holes]) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[i + 1];
        const ay = heightAt(ax, az), by = heightAt(bx, bz);
        shoreVertices.push(ax, -2, az, bx, -2, bz, bx, by, bz, ax, -2, az, bx, by, bz, ax, ay, az);
      }
    }
  }
  const shoreGeometry = new THREE.BufferGeometry();
  shoreGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shoreVertices, 3));
  shoreGeometry.computeVertexNormals();
  group.add(new THREE.Mesh(shoreGeometry, new THREE.MeshStandardMaterial({ color: 0x4c4842, roughness: 1, side: THREE.DoubleSide })));

  const inside = (x, z, ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
    }
    return hit;
  };
  const buildingBounds = data.buildings.map(building => {
    const ring = building[4];
    return { ring, minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])),
      minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) };
  });
  const foliageGeometry = new THREE.IcosahedronGeometry(0.35, 0);
  const trunkGeometry = new THREE.CylinderGeometry(0.035, 0.05, 0.6, 5);
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x477557, roughness: 1 });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6e5b44, roughness: 1 });
  const treeTransform = new THREE.Object3D();
  const parkAnchors = {};
  for (const park of parks) {
    const ring = park.boundary.map(([lon, lat]) => { const p = project(lon, lat); return [p.x, p.z]; });
    if (ring.every(([x]) => x < WEST_LIMIT_X)) continue;
    const geometry = new THREE.ShapeGeometry(new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)))).toNonIndexed();
    const attribute = geometry.getAttribute('position');
    const vertices = [];
    for (let i = 0; i < attribute.count; i += 3) {
      subdivide(new THREE.Vector3().fromBufferAttribute(attribute, i),
        new THREE.Vector3().fromBufferAttribute(attribute, i + 1),
        new THREE.Vector3().fromBufferAttribute(attribute, i + 2), 0, vertices, 0.04);
    }
    geometry.dispose();
    const parkGeometry = new THREE.BufferGeometry();
    parkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    parkGeometry.computeVertexNormals();
    const lawn = new THREE.Mesh(parkGeometry, new THREE.MeshStandardMaterial({ color: 0x6f8d62, roughness: 1 }));
    lawn.userData = { name: park.name, source: `https://www.openstreetmap.org/${park.osmType}/${park.osmId}` };
    lawn.receiveShadow = true;
    group.add(lawn);
    const minX = Math.min(...ring.map(p => p[0])), maxX = Math.max(...ring.map(p => p[0]));
    const minZ = Math.min(...ring.map(p => p[1])), maxZ = Math.max(...ring.map(p => p[1]));
    const obstacles = buildingBounds.filter(b => b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ);
    const treePositions = [];
    // Individual tree positions are illustrative; park boundaries come from OSM.
    for (let x = minX + 0.5; x < maxX; x += 1.4) {
      for (let z = minZ + 0.5; z < maxZ; z += 1.4) {
        if (!inside(x, z, ring) || obstacles.some(b => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && inside(x, z, b.ring))) continue;
        treePositions.push([x, z]);
      }
    }
    const leaves = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, treePositions.length);
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treePositions.length);
    treePositions.forEach(([x, z], index) => {
      const size = 0.8 + (Math.sin(x * 17.1 + z * 23.4) + 1) * 0.2;
      treeTransform.scale.set(size, size, size);
      treeTransform.position.set(x, heightAt(x, z) + 0.3 * size, z);
      treeTransform.updateMatrix();
      trunks.setMatrixAt(index, treeTransform.matrix);
      treeTransform.position.y += 0.4 * size;
      treeTransform.updateMatrix();
      leaves.setMatrixAt(index, treeTransform.matrix);
    });
    leaves.castShadow = true;
    group.add(leaves, trunks);
    const parkCenter = project(...park.center);
    parkCenter.y = heightAt(parkCenter.x, parkCenter.z);
    parkAnchors[park.name] = parkCenter;
  }

  const quarters = buildQuarters({ group, data, heightAt, project, interactiveObjects, nightMaterials });
  const palette = [0xe2dad0, 0xd2c0a8, 0xbcd0dc, 0xe8dfd2, 0xc4cebf, 0xb4c8d4];
  const facadeAtlas = createFacadeAtlas();
  const parapetTransforms = [];
  const roofBoxTransforms = [];
  const buildingGeometries = palette.map(() => []);
  const customNames = /来福士|水晶连廊|^T[1-6][NS]?塔楼$|洪崖洞|人民大礼堂|人民解放纪念碑/;
  for (const [id, name, measuredHeight, levels, footprint] of data.buildings) {
    if (footprint.every(([x]) => x < WEST_LIMIT_X) || polygonCentroid(footprint).x < WEST_LIMIT_X) continue;
    if (customNames.test(name) || quarters.excludedBuildings.has(id)) continue;
    const groundHeights = footprint.map(([x, z]) => heightAt(x, z));
    const baseHeight = Math.max(...groundHeights);
    const foundation = Math.min(...groundHeights) - 0.05;
    const h = Math.max(2.5, measuredHeight ?? (levels ? levels * 3.2 : 18)) / scale;
    const shape = new THREE.Shape(footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: h + baseHeight - foundation, bevelEnabled: false, steps: 1 });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, foundation, 0);
    const facadeStyle = new Float32Array(geometry.attributes.position.count).fill((id * 7 + footprint.length) % 16);
    geometry.setAttribute('aFacadeStyle', new THREE.Float32BufferAttribute(facadeStyle, 1));
    buildingGeometries[id % palette.length].push(geometry);

    const roofY = baseHeight + h;
    for (let i = 0; i < footprint.length; i++) {
      const [ax, az] = footprint[i];
      const [bx, bz] = footprint[(i + 1) % footprint.length];
      const dx = bx - ax, dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      parapetTransforms.push({
        x: (ax + bx) / 2, y: roofY + 0.06, z: (az + bz) / 2,
        rotY: -Math.atan2(dz, dx),
        sx: length, sy: 0.12, sz: 0.08
      });
    }

    const centroid = polygonCentroid(footprint);
    if (centroid.area > 0.8 && h > 0.8) {
      const xs = footprint.map(([x]) => x);
      const zs = footprint.map(([, z]) => z);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanZ = Math.max(...zs) - Math.min(...zs);
      const count = centroid.area > 12 ? 3 : centroid.area > 4 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const ox = (hash01(id + k * 31) - 0.5) * spanX * 0.5;
        const oz = (hash01(id + k * 57 + 7) - 0.5) * spanZ * 0.5;
        const x = centroid.x + ox, z = centroid.z + oz;
        if (!pointInPolygon(x, z, footprint)) continue;
        const size = Math.min(0.35 + hash01(id + k * 13 + 3) * 0.7, spanX * 0.25, spanZ * 0.25);
        if (size < 0.12) continue;
        const height = 0.18 + hash01(id + k * 19 + 5) * 0.45;
        roofBoxTransforms.push({
          x, y: roofY + height / 2, z,
          rotY: hash01(id + k * 23) * Math.PI,
          sx: size, sy: height, sz: size * (0.7 + hash01(id + k * 29) * 0.6)
        });
      }
    }
  }
  buildingGeometries.forEach((geometries, index) => {
    if (!geometries.length) return;
    const material = new THREE.MeshStandardMaterial({
      color: palette[index], roughness: 0.85, metalness: 0.05,
      emissive: index % 2 ? 0xffbb66 : 0x74d4ff, emissiveIntensity: 0
    });
    material.userData.facadeAtlas = facadeAtlas;
    material.onBeforeCompile = shader => {
      shader.uniforms.uFacadeAtlas = { value: material.userData.facadeAtlas };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFacadeStyle;\nvarying vec3 vCityPosition;\nvarying vec3 vCityNormal;\nvarying float vFacade;\nvarying float vFacadeStyle;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCityPosition = position;\nvCityNormal = normal;\nvFacade = 1.0 - abs(normal.y);\nvFacadeStyle = aFacadeStyle;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uFacadeAtlas;\nvarying vec3 vCityPosition;\nvarying vec3 vCityNormal;\nvarying float vFacade;\nvarying float vFacadeStyle;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          // Triplanar facade module: keep windows vertical on every facade angle.
          vec3 cityNormal = abs(vCityNormal);
          vec2 facadeUV = cityNormal.x > cityNormal.z
            ? vec2(vCityPosition.z, vCityPosition.y)
            : vec2(vCityPosition.x, vCityPosition.y);
          vec2 cityUV = facadeUV * vec2(6.0, 3.75);
          vec2 cityPixel = max(fwidth(cityUV), vec2(0.001));
          float facadeDetail = 1.0 - smoothstep(0.25, 0.75, max(cityPixel.x, cityPixel.y));
          float style = floor(vFacadeStyle + 0.5);
          vec2 tile = vec2(mod(style, 4.0), 3.0 - floor(style / 4.0));
          vec2 cell = clamp(fract(cityUV), vec2(0.015), vec2(0.985));
          vec3 facadeTex = texture2D(uFacadeAtlas, (tile + cell) * 0.25).rgb;
          float facadeLuma = dot(facadeTex, vec3(0.299, 0.587, 0.114));
          float windowMask = (1.0 - smoothstep(0.5, 0.7, facadeLuma))
            * step(0.5, vFacade) * facadeDetail;
          float cityDepth = mix(0.78, 1.0, smoothstep(-6.0, 26.0, vCityPosition.y));
          diffuseColor.rgb *= cityDepth;
          // Roof planes read as pale ground when they keep the facade color; darken them.
          float roofMask = 1.0 - step(0.5, vFacade);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.16, 0.17), roofMask * 0.75);
          // Detail modulation only, so the palette still distinguishes buildings.
          diffuseColor.rgb *= mix(vec3(1.0), facadeTex, 0.42 * step(0.5, vFacade));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.2, 0.24), windowMask * 0.55);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance *= windowMask;`);
    };
    const merged = mergeGeometries(geometries);
    geometries.forEach(geometry => geometry.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    nightMaterials.push({ material, baseIntensity: 1.1 });
  });

  const addRoofInstances = (transforms, color) => {
    if (!transforms.length) return;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
      transforms.length
    );
    const dummy = new THREE.Object3D();
    transforms.forEach((transform, index) => {
      dummy.position.set(transform.x, transform.y, transform.z);
      dummy.rotation.set(0, transform.rotY, 0);
      dummy.scale.set(transform.sx, transform.sy, transform.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addRoofInstances(parapetTransforms, 0x6f7478);
  addRoofInstances(roofBoxTransforms, 0x7a7f82);

  const clipRoadSegment = (p1, p2, minX) => {
    let [ax, az] = p1, [bx, bz] = p2;
    if (ax < minX && bx < minX) return null;
    if (ax >= minX && bx >= minX) return [ax, az, bx, bz];
    const t = (minX - ax) / (bx - ax);
    const cutZ = az + t * (bz - az);
    if (ax < minX) return [minX, cutZ, bx, bz];
    return [ax, az, minX, cutZ];
  };

  const roadVertices = [], pathVertices = [];
  for (const [, , kind, bridge, points] of data.roads) {
    if (points.every(([x]) => x < WEST_LIMIT_X) || points.every(([x, z]) => !pointInPolygon(x, z, boundary))) continue;
    const pedestrian = ['footway', 'path', 'steps', 'pedestrian'].includes(kind);
    const width = (pedestrian ? 3 : ['trunk', 'primary'].includes(kind) ? 20 : ['secondary', 'tertiary'].includes(kind) ? 12 : 6) / scale;
    const vertices = pedestrian ? pathVertices : roadVertices;
    for (let i = 1; i < points.length; i++) {
      const seg = clipRoadSegment(points[i - 1], points[i], WEST_LIMIT_X);
      if (!seg) continue;
      const [ax, az, bx, bz] = seg;
      if (!pointInPolygon(ax, az, boundary) && !pointInPolygon(bx, bz, boundary)) continue;
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.02) continue;
      const nx = -(bz - az) / length * width / 2, nz = (bx - ax) / length * width / 2;
      if (bridge && bridge !== 'no') continue;
      const divisions = Math.max(1, Math.ceil(length / 2));
      for (let segment = 0; segment < divisions; segment++) {
        const from = segment / divisions, to = (segment + 1) / divisions;
        const x1 = THREE.MathUtils.lerp(ax, bx, from), z1 = THREE.MathUtils.lerp(az, bz, from);
        const x2 = THREE.MathUtils.lerp(ax, bx, to), z2 = THREE.MathUtils.lerp(az, bz, to);
        const y1 = heightAt(x1, z1) + 0.08, y2 = heightAt(x2, z2) + 0.08;
        vertices.push(x1 + nx, y1, z1 + nz, x2 + nx, y2, z2 + nz, x2 - nx, y2, z2 - nz,
          x1 + nx, y1, z1 + nz, x2 - nx, y2, z2 - nz, x1 - nx, y1, z1 - nz);
      }
    }
  }
  for (const [vertices, color] of [[roadVertices, 0x555e65], [pathVertices, 0xc8bba0]]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Road markings and sidewalks are generated from the same centrelines. They are
  // deliberately simple ribbons: legible at street level without a texture atlas.
  const markingVertices = [], sidewalkVertices = [];
  for (const [, , kind, bridge, points] of data.roads) {
    if (points.every(([x]) => x < WEST_LIMIT_X) || points.every(([x, z]) => !pointInPolygon(x, z, boundary))) continue;
    if (bridge && bridge !== 'no') continue;
    if (['footway', 'path', 'steps', 'pedestrian'].includes(kind)) continue;
    const width = (['trunk', 'primary'].includes(kind) ? 20 : ['secondary', 'tertiary'].includes(kind) ? 12 : 6) / scale;
    const sidewalkWidth = 0.28;
    for (let i = 1; i < points.length; i++) {
      const seg = clipRoadSegment(points[i - 1], points[i], WEST_LIMIT_X);
      if (!seg) continue;
      const [ax, az, bx, bz] = seg;
      if (!pointInPolygon(ax, az, boundary) && !pointInPolygon(bx, bz, boundary)) continue;
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.02) continue;
      const ux = (bx - ax) / length, uz = (bz - az) / length;
      const nx = -uz, nz = ux;

      for (let d = 0; d < length; d += 3.6) {
        const end = Math.min(length, d + 1.8);
        const x1 = ax + ux * d, z1 = az + uz * d;
        const x2 = ax + ux * end, z2 = az + uz * end;
        const y1 = heightAt(x1, z1) + 0.1, y2 = heightAt(x2, z2) + 0.1;
        const hw = 0.035;
        markingVertices.push(
          x1 + nx * hw, y1, z1 + nz * hw, x2 + nx * hw, y2, z2 + nz * hw, x2 - nx * hw, y2, z2 - nz * hw,
          x1 + nx * hw, y1, z1 + nz * hw, x2 - nx * hw, y2, z2 - nz * hw, x1 - nx * hw, y1, z1 - nz * hw
        );
      }

      for (const side of [-1, 1]) {
        const offset = side * (width / 2 + sidewalkWidth / 2);
        const ox = nx * offset, oz = nz * offset;
        const hw = sidewalkWidth / 2;
        const x1 = ax + ox, z1 = az + oz, x2 = bx + ox, z2 = bz + oz;
        const y1 = heightAt(x1, z1) + 0.09, y2 = heightAt(x2, z2) + 0.09;
        sidewalkVertices.push(
          x1 + nx * hw, y1, z1 + nz * hw, x2 + nx * hw, y2, z2 + nz * hw, x2 - nx * hw, y2, z2 - nz * hw,
          x1 + nx * hw, y1, z1 + nz * hw, x2 - nx * hw, y2, z2 - nz * hw, x1 - nx * hw, y1, z1 - nz * hw
        );
      }
    }
  }
  for (const [vertices, color, roughness] of [[markingVertices, 0xd8d2b8, 0.9], [sidewalkVertices, 0xb9b3a5, 0.95]]) {
    if (!vertices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const anchor = (lon, lat) => {
    const point = project(lon, lat);
    point.y = heightAt(point.x, point.z);
    return point;
  };
  const addLandmark = (object, name, position, source) => {
    object.position.copy(position);
    object.userData = { name, desc: `依据公开资料建立的外部模型。来源：${source}`, source };
    group.add(object);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(5, 7, 5), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 3;
    hit.userData = object.userData;
    object.add(hit);
    interactiveObjects.push(hit);
  };

  const monument = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(10 / scale, 10 / scale, 1.6 / scale, 48), stone);
  base.position.y = 0.8 / scale;
  monument.add(base);
  const radius = 2.55 / (2 * Math.sin(Math.PI / 8)) / scale;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 22.4 / scale, 8), stone);
  column.position.y = (1.6 + 11.2) / scale;
  monument.add(column);
  const clockHousing = new THREE.Mesh(new THREE.BoxGeometry(5 / scale, 2.6 / scale, 5 / scale), stone);
  clockHousing.position.y = 25.3 / scale;
  monument.add(clockHousing);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6 / scale, 0.9 / scale, 8), stone);
  roof.position.y = 27.05 / scale;
  monument.add(roof);
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.42 / scale, 0.5 / scale, 1.2 / scale, 8), stone);
    post.position.set(Math.sin(angle) * 8.5 / scale, 2.2 / scale, Math.cos(angle) * 8.5 / scale);
    monument.add(post);
  }
  const inscriptionCanvas = document.createElement('canvas');
  inscriptionCanvas.width = 128;
  inscriptionCanvas.height = 1024;
  const inscriptionContext = inscriptionCanvas.getContext('2d');
  inscriptionContext.fillStyle = '#383a34';
  inscriptionContext.font = '96px "Noto Sans SC", sans-serif';
  inscriptionContext.textAlign = 'center';
  [...'人民解放纪念碑'].forEach((character, index) => inscriptionContext.fillText(character, 64, 125 + index * 127));
  const inscription = new THREE.Mesh(new THREE.PlaneGeometry(1.4 / scale, 14 / scale),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(inscriptionCanvas), transparent: true }));
  const inscriptionAngle = Math.PI / 8;
  inscription.position.set(Math.sin(inscriptionAngle) * (radius * Math.cos(Math.PI / 8) + 0.004), 13 / scale,
    Math.cos(inscriptionAngle) * (radius * Math.cos(Math.PI / 8) + 0.004));
  inscription.rotation.y = inscriptionAngle;
  monument.add(inscription);
  monument.rotation.y = Math.PI - inscriptionAngle - 0.15;
  const clockMaterial = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    const face = new THREE.Group();
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.95 / scale, 32), clockMaterial);
    face.add(dial);
    const hands = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0.005), new THREE.Vector3(0, 0.065, 0.005),
      new THREE.Vector3(0, 0, 0.005), new THREE.Vector3(0.045, 0.025, 0.005)
    ]), new THREE.LineBasicMaterial({ color: 0x27313b }));
    face.add(hands);
    face.position.set(Math.sin(angle) * 2.51 / scale, 25.3 / scale, Math.cos(angle) * 2.51 / scale);
    face.rotation.y = angle;
    monument.add(face);
  }
  const jiefangbei = anchor(106.57334, 29.56020);
  addLandmark(monument, '人民解放纪念碑 · 27.5米', jiefangbei, MODEL_SOURCES.jiefangbei);

  const auditorium = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0x9c3029, roughness: 0.75 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x176f67, roughness: 0.6 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd5a64c, emissive: 0xd58e24, emissiveIntensity: 0, metalness: 0.35 });
  nightMaterials.push({ material: gold, baseIntensity: 1.0 });
  const hallPodium = new THREE.Mesh(new THREE.CylinderGeometry(30 / scale, 34 / scale, 19.2 / scale, 48), stone);
  hallPodium.position.y = 9.6 / scale;
  auditorium.add(hallPodium);
  const hallBody = new THREE.Mesh(new THREE.CylinderGeometry(23.165 / scale, 23.165 / scale, 20.8 / scale, 48), red);
  hallBody.position.y = 29.6 / scale;
  auditorium.add(hallBody);
  for (let tier = 0; tier < 3; tier++) {
    const radius = (31 - tier * 7) / scale;
    const roofTier = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius, 6 / scale, 64), roofMaterial);
    roofTier.position.y = (43 + tier * 7) / scale;
    auditorium.add(roofTier);
    const eave = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.22 / scale, 6, 64), gold);
    eave.rotation.x = Math.PI / 2;
    eave.position.y = (40 + tier * 7) / scale;
    auditorium.add(eave);
  }
  const finial = new THREE.Mesh(new THREE.ConeGeometry(1.2 / scale, 5 / scale, 16), gold);
  finial.position.y = 62.5 / scale;
  auditorium.add(finial);
  const pillarGeos = [];
  const p1 = new THREE.CylinderGeometry(0.45 / scale, 0.45 / scale, 20.8 / scale, 8);
  for (let i = 0; i < 20; i++) {
    const angle = i / 20 * Math.PI * 2;
    const geo = p1.clone();
    geo.translate(Math.sin(angle) * 24 / scale, 29.6 / scale, Math.cos(angle) * 24 / scale);
    pillarGeos.push(geo);
  }
  p1.dispose();
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(34 / scale, 18 / scale, 20 / scale), stone);
    wing.position.set(side * 43 / scale, 28.2 / scale, 0);
    auditorium.add(wing);
    const wingRoof = new THREE.Mesh(new THREE.ConeGeometry(23 / scale, 7 / scale, 4), roofMaterial);
    wingRoof.rotation.y = Math.PI / 4;
    wingRoof.scale.z = 0.62;
    wingRoof.position.set(side * 43 / scale, 40.7 / scale, 0);
    auditorium.add(wingRoof);
    const p2 = new THREE.CylinderGeometry(0.4 / scale, 0.4 / scale, 18 / scale, 8);
    for (let i = 0; i < 8; i++) {
      const geo = p2.clone();
      geo.translate((side * 43 + (i - 3.5) * 4) / scale, 28.2 / scale, 10.1 / scale);
      pillarGeos.push(geo);
    }
    p2.dispose();
  }
  if (pillarGeos.length) {
    const mergedPillars = mergeGeometries(pillarGeos);
    auditorium.add(new THREE.Mesh(mergedPillars, red));
    pillarGeos.forEach(g => g.dispose());
  }

  const stepGeos = [];
  const stepBase = new THREE.BoxGeometry(30 / scale, 0.15 / scale, 0.35 / scale);
  for (let i = 0; i < 128; i++) {
    const geo = stepBase.clone();
    geo.translate(0, (19.2 - i * 0.15) / scale, (27 + i * 0.3) / scale);
    stepGeos.push(geo);
  }
  stepBase.dispose();
  if (stepGeos.length) {
    const mergedSteps = mergeGeometries(stepGeos);
    auditorium.add(new THREE.Mesh(mergedSteps, stone));
    stepGeos.forEach(g => g.dispose());
  }
  auditorium.rotation.y = -80 * Math.PI / 180;
  const auditoriumPosition = anchor(106.5504091, 29.5643216);
  addLandmark(auditorium, '人民大礼堂 · 65米', auditoriumPosition, MODEL_SOURCES.auditorium);

  const hongyadong = new THREE.Group();
  const timber = new THREE.MeshStandardMaterial({ color: 0x69492f, roughness: 0.85 });
  const tile = new THREE.MeshStandardMaterial({ color: 0x424a47, roughness: 0.9 });
  const lantern = new THREE.MeshStandardMaterial({ color: 0xf9ce79, emissive: 0xffad32, emissiveIntensity: 0 });
  nightMaterials.push({ material: lantern, baseIntensity: 2.0 });
  const floorHeight = 79 / 11 / scale;

  const timberGeos = [];
  const lanternGeos = [];
  const tileGeos = [];

  for (let level = 0; level < 11; level++) {
    const width = (145 - Math.max(0, level - 5) * 10) / scale;
    const depth = (22 + level * 1.8) / scale;
    const floorGeo = new THREE.BoxGeometry(width, floorHeight * 0.8, depth);
    floorGeo.translate(0, (level + 0.4) * floorHeight, level * 0.18);
    timberGeos.push(floorGeo);

    const railingGeo = new THREE.BoxGeometry(width + 0.15, 0.09, 0.09);
    railingGeo.translate(0, (level + 0.15) * floorHeight, depth / 2 + level * 0.18 + 0.08);
    lanternGeos.push(railingGeo);

    for (let bay = 0; bay < 9; bay++) {
      const colGeo = new THREE.BoxGeometry(0.06, floorHeight, 0.06);
      colGeo.translate((bay - 4) / 9 * width, (level + 0.5) * floorHeight, depth / 2 + level * 0.18 + 0.05);
      timberGeos.push(colGeo);

      const winGeo = new THREE.PlaneGeometry(width / 18, floorHeight * 0.38);
      winGeo.translate((bay - 4) / 9 * width, (level + 0.5) * floorHeight, depth / 2 + level * 0.18 + 0.06);
      lanternGeos.push(winGeo);
    }
    if ([3, 6, 8, 10].includes(level)) {
      for (let bay = 0; bay < 5; bay++) {
        const eaveGeo = new THREE.ConeGeometry(width / 7, 0.38, 4);
        eaveGeo.rotateY(Math.PI / 4);
        eaveGeo.scale(1, 1, 0.65);
        eaveGeo.translate((bay - 2) * width / 5, (level + 1) * floorHeight, depth / 2 + level * 0.18);
        tileGeos.push(eaveGeo);
      }
    }
  }

  if (timberGeos.length) {
    const m = mergeGeometries(timberGeos);
    hongyadong.add(new THREE.Mesh(m, timber));
    timberGeos.forEach(g => g.dispose());
  }
  if (lanternGeos.length) {
    const m = mergeGeometries(lanternGeos);
    hongyadong.add(new THREE.Mesh(m, lantern));
    lanternGeos.forEach(g => g.dispose());
  }
  if (tileGeos.length) {
    const m = mergeGeometries(tileGeos);
    hongyadong.add(new THREE.Mesh(m, tile));
    tileGeos.forEach(g => g.dispose());
  }
  hongyadong.rotation.y = Math.PI;
  const hongyadongPosition = project(106.5752958, 29.5650734);
  hongyadongPosition.y = 0.7;
  addLandmark(hongyadong, '洪崖洞 · 11层立体街区', hongyadongPosition, MODEL_SOURCES.hongyadong);

  const bounds = new THREE.Box3().setFromPoints(boundary.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z)));
  const rafflesFootprint = data.buildings.find(building => /来福士/.test(building[1]))[4];
  const rafflesCenter = rafflesFootprint.slice(0, -1).reduce((center, [x, z]) => center.add(new THREE.Vector3(x, 0, z)), new THREE.Vector3())
    .divideScalar(rafflesFootprint.length - 1);
  rafflesCenter.y = heightAt(rafflesCenter.x, rafflesCenter.z);
  const tipPoint = boundary.reduce((east, point) => point[0] > east[0] ? point : east);
  scene.add(group);
  return { group, data, boundary, bounds, project, anchor, heightAt, jiefangbei,
    raffles: rafflesCenter, hongyadong: anchor(106.5752958, 29.5650734),
    // Facade metrics for the guided-route overlay: 11 floors over the model's 79 m.
    hongyadongModel: { position: hongyadongPosition.clone(), floorHeight, floors: 11, baseY: 0.7 },
    auditorium: auditoriumPosition, eling: parkAnchors['鹅岭公园'] || new THREE.Vector3(), parks: parkAnchors,
    huguang: quarters.huguang, shibati: quarters.shibati, liziba: quarters.liziba, updateTransit: quarters.update,
    elevation,
    tip: new THREE.Vector3(tipPoint[0], 0, tipPoint[1]) };
}
