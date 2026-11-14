import { Matrix3, Matrix4, Spherical, Vector3 } from 'three';
import { focusView, cancelViewReset, restoreFocusLimits } from '../src/view-reset.mjs';

// Anchors follow their owning mesh (including animated decal bones), while
// camera targets and orbit directions use model-viewer's separate spaces.
export function annotationFocusPose({ scene, root, anchor, normal, radius, orbit }) {
  scene.updateMatrixWorld(true);
  root.updateWorldMatrix(true, false);
  const target = root.localToWorld(anchor.clone());
  scene.target.worldToLocal(target);
  let theta = orbit.theta,
    phi = orbit.phi;
  if (normal?.lengthSq() > 0) {
    const direction = normal
      .clone()
      .applyNormalMatrix(new Matrix3().getNormalMatrix(root.matrixWorld))
      .transformDirection(new Matrix4().copy(scene.matrixWorld).invert());
    const spherical = new Spherical().setFromVector3(direction);
    theta += Math.atan2(Math.sin(spherical.theta - theta), Math.cos(spherical.theta - theta));
    phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));
  }
  return { target, orbit: { theta, phi, radius: Math.max(0.01, radius) } };
}

export function focusAnnotation(viewer, pose) {
  viewer.dispatchEvent(new CustomEvent('annotation-focus', { detail: pose }));
}

export function bindAnnotationButton(button, { activate, enter, leave }) {
  button.type = 'button';
  let hovered = false,
    focused = false;
  const update = (kind, value) => {
    const wasActive = hovered || focused;
    if (kind === 'hover') hovered = value;
    else focused = value;
    if (!wasActive && (hovered || focused)) enter?.();
    else if (wasActive && !hovered && !focused) leave?.();
  };
  const listeners = {
    click: activate,
    pointerenter: () => update('hover', true),
    pointerleave: () => update('hover', false),
    focus: () => update('focus', true),
    blur: () => update('focus', false),
  };
  for (const [event, handler] of Object.entries(listeners)) button.addEventListener(event, handler);
  return () => {
    for (const [event, handler] of Object.entries(listeners))
      button.removeEventListener(event, handler);
  };
}

// The browser integration supplies private controls; annotations stay usable
// without importing the browser element or changing public orbit attributes.
export function installAnnotationFocus(viewer, controls, scene) {
  let finishClipping;
  const focus = (event) =>
    focusView(viewer, event.detail, {
      setRadiusLimits(minimumRadius, maximumRadius) {
        finishClipping?.();
        const previous = {
          minimumRadius: controls.options.minimumRadius,
          maximumRadius: controls.options.maximumRadius,
        };
        controls.applyOptions({ minimumRadius, maximumRadius });
        // Numeric controls options do not trigger model-viewer's public
        // max-camera-orbit handler, which normally expands the far plane.
        const camera = scene?.getCamera(), far = camera?.far;
        if (camera) {
          camera.far = Math.max(far, maximumRadius * 2);
          camera.updateProjectionMatrix();
        }
        return () => {
          controls.applyOptions(previous);
          if (camera) {
            const update = () => {
              const extent = Math.max(far, viewer.getCameraOrbit().radius * 2);
              if (camera.far !== extent) {
                camera.far = extent;
                camera.updateProjectionMatrix();
              }
              if (extent === far) finishClipping();
            };
            finishClipping = () => {
              viewer.removeEventListener('camera-change', update);
              finishClipping = undefined;
              camera.far = far;
              camera.updateProjectionMatrix();
            };
            viewer.addEventListener('camera-change', update);
            update();
          }
        };
      },
    });
  viewer.addEventListener('annotation-focus', focus);
  return () => {
    viewer.removeEventListener('annotation-focus', focus);
    cancelViewReset(viewer);
    restoreFocusLimits(viewer);
    finishClipping?.();
  };
}

// ModelScene attaches the wrapper synchronously in addHotspot. Camera-facing
// and offscreen hotspots still need projection when the camera moves.
export function skipEmptyHangarAnnotations(viewer, scene) {
  const renderer = scene.annotationRenderer;
  const original = renderer.render;
  function render(...args) {
    if (viewer.hangarActive && !renderer.domElement.firstElementChild) return;
    return original.apply(this, args);
  }
  renderer.render = render;
  return () => {
    if (renderer.render === render) renderer.render = original;
  };
}