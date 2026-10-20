import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { buildZengjiayan } from './zengjiayan.js';

test('mapped Zengjiayan bridge builds finite geometry with the published deck width', () => {
  const resource = JSON.parse(readFileSync(new URL('./peninsula-snapshot.json', import.meta.url), 'utf8'));
  const data = JSON.parse(inflateSync(Buffer.from(resource.data, 'base64')));
  const scene = new THREE.Scene();
  const targets = [], lights = [];
  const center = buildZengjiayan(scene, { data, heightAt: () => 4 }, targets, lights);
  assert.equal(scene.children.length, 1);
  assert.equal(lights.length, 1);
  assert.ok(targets.length > 0);
  for (const mesh of targets) {
    assert.equal(mesh.userData.name, '曾家岩嘉陵江大桥');
    assert.ok(mesh.geometry.getAttribute('position').array.every(Number.isFinite));
  }
  const deck = targets.find(mesh => mesh.material.color.getHex() === 0x4a5055);
  deck.geometry.computeBoundingBox();
  assert.ok(deck.geometry.boundingBox.containsPoint(center));
  // The nearly north-south mapped bridge must retain its full 32.6m lateral deck width.
  assert.ok(deck.geometry.boundingBox.max.x - deck.geometry.boundingBox.min.x >= 32.6 / data.meta.metersPerUnit - 0.01);
});
