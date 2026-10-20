import * as THREE from 'three';

export function bridgeMember(a, b, thickness, breadth = thickness) {
  const direction = b.clone().sub(a);
  const geometry = new THREE.BoxGeometry(breadth, direction.length(), thickness);
  direction.normalize();
  const across = new THREE.Vector3(0, 1, 0).cross(direction);
  if (across.lengthSq() < 0.000001) across.set(1, 0, 0);
  across.normalize();
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(across, direction, across.clone().cross(direction)));
  geometry.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
  return geometry;
}
