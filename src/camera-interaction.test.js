import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CLICK_SLOP, classifyPointer, computeFocusPose, isDoubleTap, isTypingTarget, isVisibleInHierarchy
} from './camera-interaction.js';

test('mouse press under the slop is a click, beyond it is a drag', () => {
  assert.equal(classifyPointer({ startX: 10, startY: 10, endX: 13, endY: 14 }), 'click');
  assert.equal(classifyPointer({ startX: 10, startY: 10, endX: 10 + CLICK_SLOP.mouse + 1, endY: 10 }), 'drag');
});

test('touch taps use a looser threshold than the mouse', () => {
  const startX = 10, startY = 10, endX = 10 + CLICK_SLOP.mouse + 2, endY = 10;
  assert.equal(classifyPointer({ startX, startY, endX, endY, pointerType: 'mouse' }), 'drag');
  assert.equal(classifyPointer({ startX, startY, endX, endY, pointerType: 'touch' }), 'click');
  assert.equal(classifyPointer({ startX, startY, endX: startX + CLICK_SLOP.touch + 1, endY, pointerType: 'touch' }), 'drag');
});

test('double tap needs a quick second tap near the first', () => {
  const first = { time: 1000, x: 20, y: 20 };
  assert.equal(isDoubleTap(first, { time: 1200, x: 25, y: 22 }), true);
  assert.equal(isDoubleTap(first, { time: 1500, x: 25, y: 22 }), false);
  assert.equal(isDoubleTap(first, { time: 1200, x: 80, y: 22 }), false);
  assert.equal(isDoubleTap(first, { time: 1200, x: 25, y: 22 }, 'mouse'), false);
});

test('focus translates camera and target together and keeps the view direction', () => {
  const camera = new THREE.Vector3(10, 20, 30);
  const target = new THREE.Vector3(0, 0, 0);
  const focus = new THREE.Vector3(40, 5, -20);
  const pose = computeFocusPose(camera, target, focus, { minDistance: 4, maxDistance: 2500 });

  assert.deepEqual(pose.target.toArray(), focus.toArray());

  const before = camera.clone().sub(target).normalize();
  const after = pose.position.clone().sub(pose.target).normalize();
  assert.ok(before.distanceTo(after) < 1e-9, 'view direction changed');

  const delta = pose.position.clone().sub(camera);
  const targetDelta = pose.target.clone().sub(target);
  assert.ok(delta.distanceTo(targetDelta) < 1e-9, 'camera did not follow the target');
});

test('focus clamps the distance to the controls limits', () => {
  const camera = new THREE.Vector3(0, 0, 1000);
  const target = new THREE.Vector3(0, 0, 0);
  const far = computeFocusPose(camera, target, new THREE.Vector3(0, 0, -1000), { minDistance: 4, maxDistance: 500 });
  assert.ok(Math.abs(far.position.distanceTo(far.target) - 500) < 1e-6);

  const near = computeFocusPose(new THREE.Vector3(0, 0, 1), target, new THREE.Vector3(0, 0, 1000), { minDistance: 4, maxDistance: 2500 });
  assert.ok(Math.abs(near.position.distanceTo(near.target) - 4) < 1e-6);
});

test('focus respects the polar limit without collapsing the distance', () => {
  const camera = new THREE.Vector3(0, 100, 0);
  const target = new THREE.Vector3(0, 0, 0);
  const pose = computeFocusPose(camera, target, new THREE.Vector3(10, 0, 10), {
    minDistance: 4, maxDistance: 2500, minPolarAngle: 0.12, maxPolarAngle: Math.PI / 2 - 0.05
  });
  const spherical = new THREE.Spherical().setFromVector3(pose.position.clone().sub(pose.target));
  assert.ok(spherical.phi >= 0.12 - 1e-9 && spherical.phi <= Math.PI / 2 - 0.05 + 1e-9);
  assert.ok(Math.abs(pose.position.distanceTo(pose.target) - camera.distanceTo(target)) < 1e-6);
});

test('typing targets and invisible landmark parents are filtered', () => {
  const input = { isContentEditable: false, closest: selector => selector.includes('input') ? {} : null };
  assert.equal(isTypingTarget(input), true);
  assert.equal(isTypingTarget({ closest: () => null }), false);

  const scene = new THREE.Object3D();
  const landmark = new THREE.Object3D();
  const hitbox = new THREE.Object3D();
  landmark.add(hitbox);
  scene.add(landmark);
  assert.equal(isVisibleInHierarchy(hitbox), true);
  landmark.visible = false;
  assert.equal(isVisibleInHierarchy(hitbox), false);
});
