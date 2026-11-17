import assert from 'node:assert/strict';
import test from 'node:test';
import {circlePoints, linePoints} from './scene-lines.js';

test('incomplete bezier lines are skipped instead of breaking the first frame', () => {
  const path = {
    type: 'trinity.EveBezierCurve',
    point1: [0, 0, 100],
    lineWidth: 2,
  };

  assert.deepEqual(linePoints(path), []);
});

test('line generation rejects non-finite circle radii and clock values', () => {
  assert.deepEqual(circlePoints({circleRadius: undefined}), []);
  assert.deepEqual(circlePoints({circleRadius: Number.NaN}), []);

  const path = {
    type: 'trinity.EveBezierCurve',
    point1: [0, 0, 0],
    bezierPoint: [50, 0, 0],
    point2: [100, 0, 0],
    segments: 8,
  };
  assert.ok(linePoints(path, Number.NaN).length > 0);
});
