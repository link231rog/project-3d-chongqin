import * as THREE from 'three';

// Pointer travel (CSS px) below which a press counts as a click/tap, not a drag.
export const CLICK_SLOP = { mouse: 5, touch: 10 };
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_SLOP = 30;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function classifyPointer({ startX, startY, endX, endY, pointerType = 'mouse' }) {
  const slop = pointerType === 'touch' ? CLICK_SLOP.touch : CLICK_SLOP.mouse;
  return Math.hypot(endX - startX, endY - startY) <= slop ? 'click' : 'drag';
}

export function isDoubleTap(previous, next, pointerType = 'touch') {
  if (!previous || pointerType !== 'touch') return false;
  return next.time - previous.time <= DOUBLE_TAP_MS &&
    Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_SLOP;
}

// Keyboard must never steal keys while the user is typing or operating a control.
export function isTypingTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}

// An invisible hitbox is only usable when it hangs off a visible landmark.
export function isVisibleInHierarchy(object) {
  for (let node = object; node; node = node.parent) {
    if (node.visible === false) return false;
  }
  return Boolean(object.parent);
}

// Focus keeps the current view direction: target and camera translate together,
// then the target-to-camera distance is clamped to the controls' safe range.
export function computeFocusPose(cameraPosition, target, focusPoint, {
  minDistance = 0,
  maxDistance = Infinity,
  minPolarAngle = 0,
  maxPolarAngle = Math.PI
} = {}) {
  const offset = new THREE.Vector3().subVectors(cameraPosition, target);
  const radius = offset.length();
  const direction = radius > 1e-6
    ? offset.divideScalar(radius)
    : new THREE.Vector3(0, 1, 0);

  const spherical = new THREE.Spherical().setFromVector3(direction);
  spherical.phi = clamp(spherical.phi, minPolarAngle, maxPolarAngle);
  const safeDirection = new THREE.Vector3().setFromSpherical(spherical);
  const distance = clamp(radius, minDistance, maxDistance);

  return {
    target: focusPoint.clone(),
    position: focusPoint.clone().addScaledVector(safeDirection, distance)
  };
}
