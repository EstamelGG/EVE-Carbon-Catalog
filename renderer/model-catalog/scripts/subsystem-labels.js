import {Box3, Sphere, Vector3} from 'three';
import {beforeSceneRender} from './effect-resources.js';
import {layoutSubsystemLabels} from './subsystem-label-layout.mjs';
import {installSubsystemOutlines, subsystemColors} from './subsystem-outlines.js';
import {annotationFocusPose, bindAnnotationButton, focusAnnotation} from './annotation-focus.js';

export function installSubsystemLabels(viewer, scene, describe, composer) {
  const document = viewer.ownerDocument, mount = viewer.parentElement;
  if (!document || !mount) return () => {};
  const controls = viewer.getRootNode();
  const layer = document.createElement('div');
  layer.className = 'ship-annotations subsystem-labels';
  layer.hidden = true;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('subsystem-leaders');
  layer.append(svg);
  const entries = [];
  scene.model.updateWorldMatrix(true, true);
  scene.model.traverse(root => {
    const slot = root.userData.eveSubsystemSlot;
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return;
    const bounds = new Box3();
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (let node = mesh; node && node !== root; node = node.parent) if (node.userData.eveEffects) return;
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    });
    if (bounds.isEmpty()) return;
    const anchor = root.worldToLocal(bounds.getCenter(new Vector3()));
    const radius = bounds.getBoundingSphere(new Sphere()).radius;
    const label = document.createElement('button'), title = document.createElement('strong'), name = document.createElement('span');
    label.className = 'ship-annotation subsystem-label';
    label.dataset.subsystemLabel = String(slot);
    label.style.setProperty('--annotation-accent', subsystemColors[slot]);
    label.append(title, name); layer.append(label);
    const line = document.createElementNS(svg.namespaceURI, 'path'), dot = document.createElementNS(svg.namespaceURI, 'circle');
    dot.setAttribute('r', '2.5'); svg.append(line, dot);
    line.style.setProperty('--annotation-accent', subsystemColors[slot]);
    dot.style.setProperty('--annotation-accent', subsystemColors[slot]);
    entries.push({slot, root, anchor, radius, label, title, name, line, dot});
  });
  if (entries.length !== 4) return () => {};
  mount.append(layer);
  const outlines = installSubsystemOutlines(scene, entries, composer);
  let active = false, enabled = true, disposed = false, hovered = null, bubbleHover = false, fadeTimer, hideTimer;
  const scheduleHide = () => {
    clearTimeout(fadeTimer); clearTimeout(hideTimer);
    fadeTimer = setTimeout(() => {
      layer.classList.add('fading');
      hideTimer = setTimeout(() => { active = false; layer.hidden = true; }, 350);
    }, 3000);
  };
  const show = () => {
    if (disposed || !enabled) return;
    clearTimeout(fadeTimer); clearTimeout(hideTimer);
    active = true; layer.hidden = false; layer.classList.remove('fading');
    scene.queueRender();
    if (!bubbleHover) scheduleHide();
  };
  const highlight = (slot, bubble = false) => {
    if (disposed || !enabled || !Number.isInteger(slot) || slot < 0 || slot > 3) return;
    hovered = slot; bubbleHover = bubble;
    layer.dataset.highlightedSlot = String(slot);
    outlines.setFocus(slot); outlines.setOpacity(1);
    if (bubble) { clearTimeout(fadeTimer); clearTimeout(hideTimer); layer.classList.remove('fading'); }
  };
  const clearHighlight = () => {
    if (hovered == null) return;
    const wasBubble = bubbleHover;
    hovered = null; bubbleHover = false; layer.dataset.highlightedSlot = '';
    outlines.setOpacity(0);
    if (wasBubble && active) scheduleHide();
  };
  const listeners = [];
  const listen = (element, event, handler) => {
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  };
  for (const {slot, root, anchor, radius, label} of entries) {
    listeners.push(bindAnnotationButton(label, {
      activate:() => {
        if (disposed || !enabled || !active || label.hidden) return;
        focusAnnotation(viewer, annotationFocusPose({scene, root, anchor,
          radius:Math.max(scene.boundingSphere.radius*.18, radius*3), orbit:viewer.getCameraOrbit()}));
        show();
      },
      enter:() => highlight(slot, true),
      leave:clearHighlight,
    }));
  }
  const options = controls.getElementById?.('subsystem-options');
  if (options) {
    listen(options, 'pointerover', event => {
      const select = event.target.closest('[data-subsystem-slot]');
      if (select && !select.disabled) highlight(Number(select.dataset.subsystemSlot));
    });
    listen(options, 'pointerout', event => {
      if (event.target.closest('[data-subsystem-slot]') && !event.relatedTarget?.closest?.('[data-subsystem-slot]')) clearHighlight();
    });
  }
  const point = new Vector3();
  const unsubscribe = beforeSceneRender(scene, camera => {
    if (!active || disposed) return;
    const width = layer.clientWidth, height = layer.clientHeight;
    if (!width || !height) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const descriptions = describe(), points = [];
    const panel = controls.getElementById?.('subsystem-settings');
    const obstacles = [];
    if (panel && !panel.hidden) {
      const panelRect = panel.getBoundingClientRect(), layerRect = layer.getBoundingClientRect();
      obstacles.push({x:panelRect.left-layerRect.left, y:panelRect.top-layerRect.top, width:panelRect.width, height:panelRect.height});
    }
    for (const entry of entries) {
      const {root, anchor, label, title, name, slot, line, dot} = entry;
      root.updateWorldMatrix(true, false);
      point.copy(anchor).applyMatrix4(root.matrixWorld).project(camera);
      let visible = Number.isFinite(point.x+point.y+point.z) && point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
      for (let node = root; node; node = node.parent) visible &&= node.visible;
      label.hidden = !visible;
      line.style.display = dot.style.display = visible ? '' : 'none';
      if (!visible) continue;
      title.textContent = descriptions[slot].title;
      name.textContent = descriptions[slot].name;
      label.title = document.documentElement?.lang.startsWith('zh') ? `聚焦${descriptions[slot].title}` : `Focus ${descriptions[slot].title}`;
      points.push({entry, anchorX:(point.x+1)*width/2, anchorY:(1-point.y)*height/2, width:label.offsetWidth, height:label.offsetHeight});
    }
    for (const p of layoutSubsystemLabels(points, width, height, obstacles)) {
      const {label, line, dot} = p.entry;
      label.style.left = `${p.x}px`; label.style.top = `${p.y}px`;
      line.setAttribute('d', `M ${p.anchorX} ${p.anchorY} L ${p.endX} ${p.endY}`);
      dot.setAttribute('cx', p.anchorX); dot.setAttribute('cy', p.anchorY);
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(fadeTimer); clearTimeout(hideTimer);
    for (const remove of listeners) remove();
    unsubscribe(); outlines.dispose(); layer.remove();
  };
  dispose.show = show;
  dispose.setEnabled = value => {
    enabled = Boolean(value);
    if (!enabled) {
      clearTimeout(fadeTimer); clearTimeout(hideTimer); clearHighlight();
      clearTimeout(fadeTimer); clearTimeout(hideTimer);
      active = false; layer.hidden = true; scene.queueRender();
    }
  };
  dispose.refresh = () => {
    const select = options?.querySelector('[data-subsystem-slot]:hover');
    if (select && !select.disabled) highlight(Number(select.dataset.subsystemSlot));
    else if (active) scene.queueRender();
  };
  return dispose;
}
