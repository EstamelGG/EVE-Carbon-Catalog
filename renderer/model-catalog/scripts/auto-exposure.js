import {Frustum, Matrix4, Sphere, Vector3} from 'three';
import {beforeSceneRender} from './effect-resources.js';
import {normalPassScenes} from './occlusion.js';

// Only suppress obvious hot sources. A room full of ordinary lamps should keep
// the manually selected exposure instead of being treated as one huge light.
export const autoExposureDefaults = Object.freeze({
  threshold: 2.5,
  strength: 0.28,
  minFactor: 0.55,
  maxLights: 8,
  attackMs: 180,
  releaseMs: 1200,
  refreshMs: 250,
  reportMs: 250,
});

const scratchPosition = new Vector3();
const scratchEye = new Vector3();
const scratchSphere = new Sphere();

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function visibleInScene(light, camera) {
  if (!light?.visible || !(finite(light.intensity) > 0)) return false;
  if ((light.isPointLight || light.isSpotLight || light.isDirectionalLight) !== true) return false;
  if (!light.layers?.test(camera.layers)) return false;
  for (let node = light; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function colorLuminance(color) {
  return Math.max(0,
    finite(color?.r) * 0.2126 +
    finite(color?.g) * 0.7152 +
    finite(color?.b) * 0.0722);
}

// Point and spot lights are weighted by the fraction of their authored radius
// that reaches the camera. This keeps distant scenery lamps from suppressing
// exposure while a nearby, genuinely overpowering source still triggers it.
export function lightContribution(light, camera, frustum) {
  if (!visibleInScene(light, camera)) return 0;
  const luminance = colorLuminance(light.color);
  if (!(luminance > 0)) return 0;
  let contribution = luminance * finite(light.intensity);
  if (light.isDirectionalLight) return contribution;

  light.getWorldPosition(scratchPosition);
  const radius = Math.max(0, finite(light.distance));
  if (radius > 0) {
    scratchSphere.set(scratchPosition, radius);
    if (!frustum.intersectsSphere(scratchSphere)) return 0;
    camera.getWorldPosition(scratchEye);
    const distance = Math.max(0, scratchEye.distanceTo(scratchPosition) - radius);
    contribution *= (radius * radius) / (radius * radius + distance * distance);
  } else {
    scratchSphere.set(scratchPosition, 0);
    if (!frustum.intersectsSphere(scratchSphere)) return 0;
  }
  return Number.isFinite(contribution) ? contribution : 0;
}

// Contributions below the threshold are intentionally discarded before
// summing. Several normal room lights must not behave like one hot source.
export function exposureScore(contributions, {threshold = autoExposureDefaults.threshold, maxLights = autoExposureDefaults.maxLights} = {}) {
  const limit = Math.max(1, Math.floor(finite(maxLights, autoExposureDefaults.maxLights)));
  const hot = [];
  for (const value of contributions) {
    if (!Number.isFinite(value) || value < threshold) continue;
    hot.push(value / threshold - 1);
  }
  hot.sort((a, b) => b - a);
  let score = 0;
  for (let index = 0; index < Math.min(limit, hot.length); index++) score += hot[index];
  return score;
}

export function exposureFactor(score, {strength = autoExposureDefaults.strength, minFactor = autoExposureDefaults.minFactor} = {}) {
  if (!(score > 0)) return 1;
  const amount = finite(strength, autoExposureDefaults.strength);
  const floor = Math.min(1, Math.max(0.1, finite(minFactor, autoExposureDefaults.minFactor)));
  return Math.max(floor, Math.min(1, 1 / (1 + amount * Math.log2(1 + score))));
}

export function stepExposureFactor(previous, target, deltaMs, {
  attackMs = autoExposureDefaults.attackMs,
  releaseMs = autoExposureDefaults.releaseMs,
  minFactor = autoExposureDefaults.minFactor,
} = {}) {
  const floor = Math.min(1, Math.max(0.1, finite(minFactor, autoExposureDefaults.minFactor)));
  const from = Math.min(1, Math.max(floor, finite(previous, 1)));
  const to = Math.min(1, Math.max(floor, finite(target, 1)));
  const delta = Math.max(0, finite(deltaMs));
  if (!(delta > 0) || from === to) return to;
  // Darkening responds quickly; recovery is deliberately slower so a light
  // flickering in and out of view cannot pump the whole image.
  const duration = to < from ? attackMs : releaseMs;
  const alpha = 1 - Math.exp(-delta / Math.max(1, finite(duration, 1)));
  return from + (to - from) * alpha;
}

export function installAutoExposure(viewer, scene, {
  threshold = autoExposureDefaults.threshold,
  strength = autoExposureDefaults.strength,
  minFactor = autoExposureDefaults.minFactor,
  maxLights = autoExposureDefaults.maxLights,
  attackMs = autoExposureDefaults.attackMs,
  releaseMs = autoExposureDefaults.releaseMs,
  refreshMs = autoExposureDefaults.refreshMs,
  reportMs = autoExposureDefaults.reportMs,
  now = () => performance.now(),
} = {}) {
  const frustum = new Frustum();
  const projection = new Matrix4();
  let lights = [];
  let nextRefresh = -Infinity;
  let lastTime = null;
  let lastReport = -Infinity;
  let factor = 1;
  let baseExposure = null;
  let appliedExposure = null;
  let disposed = false;

  const state = {
    base: 1,
    exposure: 1,
    factor: 1,
    target: 1,
    score: 0,
    hotLights: 0,
    lights: 0,
  };
  viewer.autoExposure = state;

  const collect = () => {
    lights = [];
    scene.traverse(object => {
      if (object.isPointLight || object.isSpotLight || object.isDirectionalLight) lights.push(object);
    });
  };

  const stop = beforeSceneRender(scene, (camera, renderer) => {
    if (disposed || normalPassScenes.has(scene) || !renderer || !camera) return;
    const time = finite(now(), performance.now());
    if (time >= nextRefresh) {
      collect();
      nextRefresh = time + Math.max(50, finite(refreshMs, autoExposureDefaults.refreshMs));
    }
    frustum.setFromProjectionMatrix(
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const contributions = [];
    for (const light of lights) {
      const contribution = lightContribution(light, camera, frustum);
      if (contribution > 0) contributions.push(contribution);
    }
    const score = exposureScore(contributions, {threshold, maxLights});
    const target = exposureFactor(score, {strength, minFactor});
    const delta = lastTime === null ? 0 : Math.min(100, Math.max(0, time - lastTime));
    // Apply suppression on the first measured frame so loading directly into a
    // hot hangar cannot flash at full exposure before settling.
    factor = lastTime === null
      ? target
      : stepExposureFactor(factor, target, delta, {attackMs, releaseMs, minFactor});
    lastTime = time;

    const current = Math.max(0.0001,
      finite(renderer.toneMappingExposure, finite(viewer.exposure, 1)));
    // model-viewer restores its base exposure before every frame. Some
    // auxiliary passes bypass that path, so never compound on our own output.
    if (baseExposure === null ||
        appliedExposure === null ||
        Math.abs(current - appliedExposure) > 0.000001) {
      baseExposure = current;
    }
    const base = baseExposure;
    const exposure = base * factor;
    renderer.toneMappingExposure = exposure;
    appliedExposure = exposure;
    Object.assign(state, {
      base,
      exposure,
      factor,
      target,
      score,
      hotLights: contributions.filter(value => value >= threshold).length,
      lights: contributions.length,
    });
    if (time >= lastReport) {
      viewer.dataset.autoExposure = JSON.stringify({
        base: Number(base.toFixed(4)),
        exposure: Number(exposure.toFixed(4)),
        factor: Number(factor.toFixed(3)),
        score: Number(score.toFixed(3)),
        hotLights: state.hotLights,
      });
      lastReport = time + Math.max(50, finite(reportMs, autoExposureDefaults.reportMs));
    }
  }, {afterUpdates: true});

  return () => {
    if (disposed) return;
    disposed = true;
    stop();
    if (viewer.autoExposure === state) delete viewer.autoExposure;
    delete viewer.dataset.autoExposure;
  };
}
