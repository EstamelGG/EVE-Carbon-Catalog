import {effectsEnabled} from '../src/display-settings.mjs';
import { Vector3 } from 'three';
import { beforeSceneRender } from './effect-resources.js';
import {annotationFocusPose, bindAnnotationButton, focusAnnotation} from './annotation-focus.js';
import {killMarkAnchor} from './kill-mark-anchor.js';

// Attach to this viewer's mount so appearance swaps can dispose independently.
export function installKillMarkLabels(viewer, scene, meshes) {
  if (!viewer.ownerDocument || !viewer.parentElement || !meshes.length) return () => {};
  const document = viewer.ownerDocument;
  const layer = document.createElement('div');
  layer.className = 'ship-annotations kill-mark-labels';
  layer.hidden = true;
  const labels = meshes.map(mesh => {
    const {anchor, normal, radius} = killMarkAnchor(mesh);
    const label = document.createElement('button');
    label.className = 'ship-annotation kill-mark-label';
    layer.append(label);
    return {mesh, anchor, normal, radius, label};
  });
  viewer.parentElement.append(layer);
  let previousCount = viewer.killCount, active = false, disposed = false, fadeTimer, hideTimer;
  const held = new Set();
  const scheduleHide = () => {
    clearTimeout(fadeTimer); clearTimeout(hideTimer);
    if (held.size) return;
    fadeTimer = setTimeout(() => {
      layer.classList.add('fading');
      hideTimer = setTimeout(() => { active = false; layer.hidden = true; }, 350);
    }, 5000);
  };
  const changed = value => {
    if (disposed || value === previousCount) return;
    previousCount = value;
    clearTimeout(fadeTimer); clearTimeout(hideTimer);
    active = value > 0;
    layer.classList.remove('fading');
    if (!active) { layer.hidden = true; return; }
    scheduleHide();
  };
  const listeners = labels.map(entry => bindAnnotationButton(entry.label, {
    activate:() => {
      const {mesh, anchor, normal, radius, label} = entry;
      if (disposed || layer.hidden || label.hidden || viewer.killCount <= 0 || !effectsEnabled(viewer.displaySettings)) return;
      mesh.updateWorldMatrix(true, false);
      const scale = mesh.getWorldScale(new Vector3());
      // Leave enough surrounding hull visible to locate the mark after focusing.
      focusAnnotation(viewer, annotationFocusPose({scene, root:mesh, anchor, normal,
        radius:Math.max(scene.boundingSphere.radius*.4, radius*Math.max(scale.x, scale.y, scale.z)*8),
        orbit:viewer.getCameraOrbit()}));
      scheduleHide();
    },
    enter:() => {
      held.add(entry.label); clearTimeout(fadeTimer); clearTimeout(hideTimer); layer.classList.remove('fading');
    },
    leave:() => { held.delete(entry.label); if (active) scheduleHide(); },
  }));
  const point = new Vector3();
  const unsubscribe = beforeSceneRender(scene, camera => {
    const enabled = active && viewer.killCount > 0 && effectsEnabled(viewer.displaySettings);
    layer.hidden = !enabled;
    if (!enabled) return;
    for (const {mesh, anchor, label} of labels) {
      let visible = true;
      for (let node = mesh; node; node = node.parent) if (!node.visible) visible = false;
      mesh.updateWorldMatrix(true, false);
      point.copy(anchor).applyMatrix4(mesh.matrixWorld).project(camera);
      label.hidden = !visible || !Number.isFinite(point.x + point.y + point.z) ||
        point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      label.style.left = `${(point.x + 1) * 50}%`;
      label.style.top = `${(1 - point.y) * 50}%`;
      label.classList.toggle('label-left', point.x > 0.65);
      label.style.transform = point.x > 0.65 ? 'translate(calc(-100% - 28px), -50%)' : '';
      label.textContent = document.documentElement.lang.startsWith('zh') ? '击杀标记' : 'Kill marks';
      label.title = document.documentElement.lang.startsWith('zh') ? '聚焦击杀标记' : 'Focus kill marks';
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(fadeTimer); clearTimeout(hideTimer);
    for (const remove of listeners) remove();
    unsubscribe(); layer.remove();
  };
  dispose.changed = changed;
  return dispose;
}
