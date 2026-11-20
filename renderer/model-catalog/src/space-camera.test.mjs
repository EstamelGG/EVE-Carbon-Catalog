import assert from 'node:assert/strict';
import test from 'node:test';
import {previewDistances, previewFov, previewLens, stepZoom, wheelUnits, zoomProportion, zoomRadius, zoomTarget} from './space-camera.mjs';

test('the space preview scales the lens angle above 16:10 and uses a linear midpoint at reset', () => {
  assert.equal(previewFov(previewLens, 1), previewLens);
  assert.equal(previewFov(previewLens, 3.2), previewLens / 2);
  const {near, far, home} = previewDistances(100, [3, 4, 0]);
  assert.equal(near, 106);
  assert.equal(far, 210 / Math.tan(0.5));
  assert.equal(home, (near + far) / 2);
  assert.equal(previewDistances(100000, [0, 0, 0]).far, 300000);
  // SetupSpaceCamera keeps its linear midpoint when a structure spans the far plane.
  assert.deepEqual(previewDistances(250000, [0, 0, 0]), {near:250001, far:150000, home:200000.5});
  assert.equal(zoomProportion(200000.5, 250001, 150000), 1);
});

test('wheel notches accumulate in ninth-power zoom space and ease to the exact target', () => {
  const {near, far, home} = previewDistances(100, [0, 0, 0]);
  const initial = zoomProportion(home, near, far);
  const goal = zoomTarget(initial, -120, near, far);
  assert.equal(goal, initial - 0.036);
  assert.ok(zoomRadius(goal, near, far) < home);
  assert.equal(zoomTarget(goal, 120, near, far), initial);
  assert.equal(zoomTarget(goal, 100000, near, far), 1);
  assert.equal(zoomTarget(goal, -100000, near, far), 0.2 + near / far);
  let p = stepZoom(initial, goal, 1 / 60);
  assert.equal(p, initial + (goal - initial) / 6);
  for (let i = 0; i < 120; i++) p = stepZoom(p, goal, 1 / 60);
  assert.equal(p, goal);
  assert.equal(wheelUnits({deltaY: 100, wheelDeltaY: -120}), -120);
  assert.equal(wheelUnits({deltaY: 100, wheelDeltaY: 100}), -120);
  assert.equal(wheelUnits({deltaY: -3, deltaMode: 1}), 120);
});
