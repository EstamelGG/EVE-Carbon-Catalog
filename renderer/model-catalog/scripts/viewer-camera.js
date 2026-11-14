// Camera adapters originally extracted from first-generation viewer-entry.js.
// These adapters use the installed model-viewer/Three.js APIs; no shader math lives here.
// API reference (Apache-2.0, model-viewer v4.4.0):
// https://github.com/google/model-viewer/blob/v4.4.0/packages/model-viewer/src/features/controls.ts
// https://github.com/google/model-viewer/blob/v4.4.0/packages/model-viewer/src/model-viewer-base.ts
// Camera restoration/crossfade policy is inherited application code; these
// references establish API availability, not the provenance of unrelated shaders.
import {MathUtils, Vector3} from 'three';
import {$controls} from '@google/model-viewer/lib/features/controls.js';
import {$scene, $renderer} from '@google/model-viewer/lib/model-viewer-base.js';
import {recenteredTarget} from '../src/view-reset.mjs';

// In a room the controls own the requested orbit and the collision pass
// constrains the rendered camera. The exterior uses the original FOV zoom.
export function installViewerZoom(viewer, controls) {
  const original = controls.adjustOrbit;
  const resetRadius = controls.resetRadius;
  controls.adjustOrbit = function(theta, phi, zoom) {
    original.call(this, theta, phi, 0);
    if (!zoom) return;
    if (viewer.hangarActive) {
      this.setOrbit(undefined, undefined, this.goalSpherical.radius * Math.exp(zoom));
    } else {
      this.setFieldOfView(Math.exp(this.goalLogFov + zoom));
    }
  };
  // SmoothControls normally reanchors the target in depth after a two-finger
  // pan/pinch. Keep the target's pan plane so releasing the gesture cannot dolly.
  controls.resetRadius = function() {
    if (this.touchMode !== this.touchModeZoom) resetRadius.call(this);
  };
  return () => {
    controls.adjustOrbit = original;
    controls.resetRadius = resetRadius;
  };
}

export function captureFrame(viewer, canvas, previousOpacity = 0) {
  const source = viewer[$renderer].displayCanvas(viewer[$scene]);
  let previous;
  if (previousOpacity > 0 && canvas.width && canvas.height) {
    previous = viewer.ownerDocument.createElement('canvas');
    previous.width = canvas.width; previous.height = canvas.height;
    previous.getContext('2d').drawImage(canvas, 0, 0);
  }
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0);
  if (previous) {
    context.globalAlpha = previousOpacity;
    context.drawImage(previous, 0, 0, canvas.width, canvas.height);
    context.globalAlpha = 1;
  }
}
export async function waitForFrame(viewer) {
  await viewer.updateComplete;
  const scene = viewer[$scene], previous = scene.renderCount;
  scene.queueRender();
  // A completed asset load does not mean the restored camera/materials have
  // reached the screen. Wait for the renderer, not an arbitrary delay.
  while (viewer.isConnected && scene.renderCount === previous) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}
export function captureView(viewer) {
  return { orbit:viewer.getCameraOrbit(), target:viewer.getCameraTarget(), fov:viewer.getFieldOfView(), yaw:viewer[$scene].yaw,
    center:viewer[$scene].boundingBox.getCenter(new Vector3()) };
}
export async function restoreView(viewer, view, {recenter = false} = {}) {
  const {orbit, target, fov, yaw} = view;
  viewer.setAttribute('min-camera-orbit', `auto auto ${orbit.radius}m`);
  viewer.setAttribute('max-camera-orbit', `auto ${viewer.equipmentPreview ? '86deg' : 'auto'} ${orbit.radius}m`);
  viewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
  viewer.cameraTarget = `${target.x}m ${target.y}m ${target.z}m`;
  // The getter returns the rendered vertical FOV. The attribute expects the
  // lens angle before model-viewer's aspect-ratio adjustment.
  const scene = viewer[$scene];
  const aspectScale = Math.max(1, scene.idealAspect / scene.aspect);
  const lens = 2 * Math.atan(Math.tan(MathUtils.degToRad(fov) / 2) / aspectScale);
  viewer.fieldOfView = `${MathUtils.radToDeg(lens)}deg`;
  viewer.resetTurntableRotation(yaw);
  await viewer.updateComplete;
  viewer[$controls].setFieldOfView(fov);
  viewer.jumpCameraToGoal();
  if (recenter) return recenteredTarget(view, viewer[$scene].boundingBox.getCenter(new Vector3()));
}
