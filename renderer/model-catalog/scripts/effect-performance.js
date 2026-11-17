import { Frustum, Matrix4, Sphere, Vector3, PointLight, SpotLight } from 'three';
import {normalPassScenes} from './occlusion.js';
import { beforeSceneRender } from './effect-resources.js';

// Three skips an invisible object's entire subtree; camera layers apply to the
// light itself. Pooled lights are reparented, so use the source's path and mask.
// https://github.com/mrdoob/three.js/blob/1939c35f2d92a4c870568da011aab54dabdfdd30/src/renderers/WebGLRenderer.js#L1801-L1820
function lightVisibleInPool(light, root, mask, camera) {
  if (!(mask & camera.layers.mask)) return false;
  for (let node = light; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) return true;
  }
  return false;
}

// Stable shader light counts: move a fixed pool between influential sources
// rather than toggling hundreds of real lights and recompiling hull shaders.
export function installLightBudget(scene, root, { points = 8, spots = 4, now = () => performance.now() } = {}) {
  const sources = [];
  root.traverse(o => { if (o.isPointLight || o.isSpotLight) sources.push(o); });
  const masks = new Map(), pools = [];
  for (const [isSpot, limit] of [[false, points], [true, spots]]) {
    const candidates = sources.filter(o => !!o.isSpotLight === isSpot);
    if (candidates.length <= limit) continue;
    for (const light of candidates) { masks.set(light, light.layers.mask); light.layers.disableAll(); }
    const lights = Array.from({ length: limit }, () => {
      const light = isSpot ? new SpotLight() : new PointLight();
      light.intensity = 0;
      light.layers.enableAll();
      root.add(light);
      if (isSpot) root.add(light.target);
      return light;
    });
    pools.push({ candidates, lights, scores: new Map(), slots: lights.map(() => ({ source: null, target: null, gain: 0 })), nextSelection: 0, initialized: false });
  }
  const frustum = new Frustum(), matrix = new Matrix4(), inverse = new Matrix4();
  const eye = new Vector3(), position = new Vector3(), sphere = new Sphere();
  let lastTime = null, transitionFrame = 0;
  const stop = beforeSceneRender(scene, camera => {
    // The normals-only pass temporarily changes camera layers and does not use direct lighting.
    if (normalPassScenes.has(scene)) return;
    const time = now();
    if (!Number.isFinite(time)) return;
    const delta = lastTime === null ? 0 : Math.min(50, Math.max(0, time - lastTime));
    lastTime = time;
    if (!root.visible) return;
    inverse.copy(root.matrixWorld).invert();
    camera.getWorldPosition(eye);
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const pool of pools) {
      if (time >= pool.nextSelection || pool.cameraLayers !== camera.layers.mask) {
        pool.cameraLayers = camera.layers.mask;
      const ranked = [];
      const retained = new Set(pool.slots.map(slot => slot.target));
      for (const source of pool.candidates) {
        source.getWorldPosition(position);
        const radius = source.distance || 1e6;
        sphere.set(position, radius);
        const eligible = source.intensity > 0 && lightVisibleInPool(source, root, masks.get(source), camera) && frustum.intersectsSphere(sphere);
        const color = Math.max(source.color.r, source.color.g, source.color.b);
        const distance = Math.max(0, eye.distanceTo(position) - radius);
        const raw = eligible ? color * source.intensity * radius * radius / (radius * radius + distance * distance) : 0;
        // Authored booster flicker must not continuously change which lights
        // survive the budget. Smooth ranking only, never authored emission.
        const previous = pool.scores.get(source) ?? raw;
        const elapsed=pool.initialized?Math.max(0,time-(pool.nextSelection-250)):400;
        const score = previous + (raw - previous) * (1 - Math.exp(-elapsed / 400));
        pool.scores.set(source, score);
        if (eligible && score > 0) ranked.push({ source, score: score * (retained.has(source) ? 1.35 : 1) });
      }
        ranked.sort((a,b) => b.score - a.score);
        const selected = new Set(ranked.slice(0, pool.lights.length).map(entry => entry.source));
        const assigned = new Set(pool.slots.map(slot => slot.target).filter(source => selected.has(source)));
        const incoming = [...selected].filter(source => !assigned.has(source));
        for (const slot of pool.slots) {
          if (!selected.has(slot.target)) slot.target = incoming.shift() || null;
          if (!pool.initialized) { slot.source = slot.target; slot.gain = slot.source ? 1 : 0; }
        }
        pool.initialized = true;
        pool.nextSelection = time + 250;
      }
      pool.lights.forEach((light, index) => {
        const slot = pool.slots[index];
        // A slot never teleports while lit: fade the old source out, move at
        // zero intensity, then fade the replacement in. Keep shader counts fixed.
        if (slot.source !== slot.target) {
          slot.gain = Math.max(0, slot.gain - delta / 180);
          if (slot.gain === 0) slot.source = slot.target;
        } else if (slot.source) slot.gain = Math.min(1, slot.gain + delta / 180);
        const source = slot.source;
        light.intensity = source && lightVisibleInPool(source, root, masks.get(source), camera) ? source.intensity * slot.gain : 0;
        if (!source) return;
        light.color.copy(source.color); light.distance = source.distance; light.decay = source.decay;
        light.position.copy(source.getWorldPosition(position)).applyMatrix4(inverse);
        light.updateMatrixWorld(true);
        if (light.isSpotLight) {
          light.angle = source.angle; light.penumbra = source.penumbra;
          light.target.position.copy(source.target.getWorldPosition(position)).applyMatrix4(inverse);
          light.target.updateMatrixWorld(true);
        }
      });
    }
    if (!transitionFrame && pools.some(pool => pool.slots.some(slot =>
      slot.source !== slot.target || (slot.target && slot.gain < 1)))) {
      transitionFrame = globalThis.requestAnimationFrame?.(() => {
        transitionFrame = 0;
        scene.queueRender?.();
      }) || 0;
    }
  });
  return () => {
    stop();
    if (transitionFrame) globalThis.cancelAnimationFrame?.(transitionFrame);
    for (const [source, mask] of masks) source.layers.mask = mask;
    for (const { lights } of pools) for (const light of lights) { light.removeFromParent(); if (light.isSpotLight) light.target.removeFromParent(); }
  };
}

// Intern shared ancestor prefixes once; evaluate each prefix once per pass.
export function createTransformCache(paths, evaluate, cameraDependent=()=>true) {
  const nodes = [{ world: new Matrix4(), children: new Map() }];
  let initialized=false;
  const leaves = paths.map(path => {
    let parent = 0;
    for (const transform of path) {
      const key = JSON.stringify(transform), children = nodes[parent].children;
      if (!children.has(key)) {
        children.set(key, nodes.length);
        nodes.push({ parent, transform, cameraDependent:nodes[parent].cameraDependent || cameraDependent(transform), children: new Map(), world: new Matrix4() });
      }
      parent = children.get(key);
    }
    return parent;
  });
  return {
    size: nodes.length - 1,
    update(base, eye, rotation) {
      const rootChanged=!initialized || !nodes[0].world.equals(base);
      initialized=true;nodes[0].world.copy(base);
      for (let i=1;i<nodes.length;i++) {
        const node = nodes[i];
        if(rootChanged || node.cameraDependent)node.world.copy(evaluate(node.transform, nodes[node.parent].world, eye, rotation));
      }
    },
    get: index => nodes[leaves[index]].world,
  };
}
