import assert from 'node:assert/strict';
import test from 'node:test';
import {Frustum, Matrix4, PerspectiveCamera, PointLight, Scene} from 'three';
import {
  autoExposureDefaults,
  exposureFactor,
  exposureScore,
  installAutoExposure,
  lightContribution,
  stepExposureFactor,
} from './auto-exposure.js';

function cameraAt(z = 10) {
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, z);
  camera.updateMatrixWorld(true);
  return camera;
}

function frustumFor(camera) {
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

function pointLight(intensity, {position = [0, 0, 0], radius = 100, color = 0xffffff} = {}) {
  const light = new PointLight(color, intensity, radius);
  light.position.set(...position);
  light.updateMatrixWorld(true);
  return light;
}

test('dark and ordinary scenes keep the manual exposure', () => {
  assert.equal(exposureFactor(exposureScore([])), 1);
  assert.equal(exposureScore([0, 0.1, 1]), 0);
  assert.equal(exposureFactor(exposureScore([2.4, 2.4, 2.4]), autoExposureDefaults), 1);
});

test('a single overpowering light produces bounded suppression', () => {
  const score = exposureScore([20], autoExposureDefaults);
  const factor = exposureFactor(score, autoExposureDefaults);
  assert.ok(score > 0);
  assert.ok(factor < 1);
  assert.ok(factor >= autoExposureDefaults.minFactor);
});

test('multiple normal lights cannot masquerade as one hot source', () => {
  const ordinary = Array.from({length: 12}, () => 2.49);
  assert.equal(exposureScore(ordinary, autoExposureDefaults), 0);
  assert.equal(exposureFactor(0, autoExposureDefaults), 1);
});

test('the compensation factor never exceeds manual exposure or its lower bound', () => {
  assert.equal(exposureFactor(-1, autoExposureDefaults), 1);
  assert.equal(exposureFactor(0, autoExposureDefaults), 1);
  assert.ok(exposureFactor(1e9, autoExposureDefaults) >= autoExposureDefaults.minFactor);
});

test('attack is faster than release and invalid deltas stay finite', () => {
  const attack = stepExposureFactor(1, 0.5, 100, {attackMs: 180, releaseMs: 1200});
  const release = stepExposureFactor(0.5, 1, 100, {attackMs: 180, releaseMs: 1200});
  assert.ok(1 - attack > release - 0.5);
  assert.ok(Number.isFinite(attack));
  assert.equal(stepExposureFactor(0.8, 0.8, Number.NaN), 0.8);
  assert.equal(stepExposureFactor(1, 0.2, 0, {minFactor: 0.2}), 0.2);
});

test('invisible, layer-masked and off-screen lights do not contribute', () => {
  const camera = cameraAt();
  const frustum = frustumFor(camera);
  const visible = pointLight(10, {position: [0, 0, 0], radius: 50});
  assert.ok(lightContribution(visible, camera, frustum) > 0);

  const hidden = pointLight(10, {position: [0, 0, 0], radius: 50});
  hidden.visible = false;
  assert.equal(lightContribution(hidden, camera, frustum), 0);

  const masked = pointLight(10, {position: [0, 0, 0], radius: 50});
  masked.layers.disableAll();
  assert.equal(lightContribution(masked, camera, frustum), 0);

  const behind = pointLight(10, {position: [0, 0, 20], radius: 1});
  assert.equal(lightContribution(behind, camera, frustum), 0);
});

test('distant lights are attenuated more than nearby lights', () => {
  const camera = cameraAt(50);
  const frustum = frustumFor(camera);
  const near = pointLight(10, {position: [0, 0, 40], radius: 20});
  const far = pointLight(10, {position: [0, 0, -250], radius: 20});
  assert.ok(lightContribution(near, camera, frustum) > lightContribution(far, camera, frustum));
});

test('renderer exposure is suppressed only for a hot visible source', () => {
  const scene = new Scene();
  const camera = cameraAt();
  scene.add(camera);
  const viewer = {dataset: {}};
  const renderer = {toneMappingExposure: 1.3};
  const dispose = installAutoExposure(viewer, scene, {now: () => 1000});

  scene.add(pointLight(1, {position: [0, 0, 0], radius: 50}));
  scene.onBeforeRender(renderer, scene, camera);
  assert.equal(renderer.toneMappingExposure, 1.3);
  assert.equal(viewer.autoExposure.factor, 1);

  dispose();
  const hotScene = new Scene();
  hotScene.add(camera);
  const hotViewer = {dataset: {}};
  const hotRenderer = {toneMappingExposure: 1.3};
  const disposeHot = installAutoExposure(hotViewer, hotScene, {now: () => 1000});
  hotScene.add(pointLight(100, {position: [0, 0, 0], radius: 100}));
  hotScene.onBeforeRender(hotRenderer, hotScene, camera);
  const firstExposure = hotRenderer.toneMappingExposure;
  assert.ok(hotRenderer.toneMappingExposure < 1.3);
  assert.ok(hotViewer.autoExposure.factor < 1);
  assert.ok(hotViewer.autoExposure.hotLights > 0);
  hotScene.onBeforeRender(hotRenderer, hotScene, camera);
  assert.equal(hotRenderer.toneMappingExposure, firstExposure);
  disposeHot();
  assert.equal(hotViewer.autoExposure, undefined);
  assert.equal(hotViewer.dataset.autoExposure, undefined);
});
