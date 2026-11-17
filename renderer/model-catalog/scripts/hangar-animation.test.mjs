import assert from 'node:assert/strict';
import test from 'node:test';
import {AnimationClip, Group, VectorKeyframeTrack} from 'three';
import {
  createHangarAnimation,
  hangarAnimationDelta,
  hangarAmbientClips,
} from './hangar-animation.js';

function animatedRoot() {
  const root = new Group();
  const child = new Group();
  child.name = 'Child';
  root.add(child);
  return {root, child};
}

test('hangar animation applies time zero before the first queued frame', () => {
  const {root, child} = animatedRoot();
  const clip = new AnimationClip('NormalLoop', 1, [
    new VectorKeyframeTrack('Child.scale', [0, 1], [0, 0, 0, 1, 1, 1]),
  ]);

  const animation = createHangarAnimation(root, [clip]);

  assert.deepEqual(animation.names, ['NormalLoop']);
  assert.deepEqual(child.scale.toArray(), [0, 0, 0]);
});

test('hangar animation ignores zero-duration and non-finite clocks', () => {
  const {root} = animatedRoot();
  const zeroDuration = new AnimationClip('NormalLoop', 0, [
    new VectorKeyframeTrack('Child.scale', [0, 0], [0, 0, 0, 1, 1, 1]),
  ]);

  assert.deepEqual(hangarAmbientClips([zeroDuration]), []);
  assert.equal(hangarAnimationDelta(null, 100), 0);
  assert.equal(hangarAnimationDelta(100, Number.NaN), null);
  assert.equal(hangarAnimationDelta(Number.NaN, 100), null);
  assert.equal(hangarAnimationDelta(Number.MAX_VALUE, -Number.MAX_VALUE), null);
  assert.equal(hangarAnimationDelta(100, 20000), 0.25);
});
