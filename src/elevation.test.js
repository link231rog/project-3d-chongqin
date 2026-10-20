import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleElevation } from './elevation.js';

const grid = { west: 106, south: 29, stepLongitude: 0.5, stepLatitude: 0.25,
  columns: 2, rows: 2, elevations: [100, 120, 180, 200] };

test('south-to-north row order and geographic midpoints retain the source elevations', () => {
  assert.equal(sampleElevation(grid, 106, 29), 100);
  assert.equal(sampleElevation(grid, 106.5, 29.25), 200);
  assert.equal(sampleElevation(grid, 106.25, 29.125), 150);
  assert.equal(sampleElevation(grid, 106, 29.125), 140);
});

test('a point beyond the downloaded boundary uses the nearest edge elevation', () => {
  assert.equal(sampleElevation(grid, 105, 30), 180);
});
