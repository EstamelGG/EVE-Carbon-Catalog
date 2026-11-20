// Camera adapters originally extracted from first-generation viewer-entry.js.
// These adapters use the installed model-viewer/Three.js APIs; no shader math lives here.
// API reference (Apache-2.0, model-viewer v4.4.0):
// https://github.com/google/model-viewer/blob/v4.4.0/packages/model-viewer/src/features/controls.ts
// https://github.com/google/model-viewer/blob/v4.4.0/packages/model-viewer/src/model-viewer-base.ts
// Camera restoration/crossfade policy is inherited application code; these
// references establish API availability, not the provenance of unrelated shaders.
import {MathUtils, Spherical, Vector3} from 'three';
import {$controls} from '@google/model-viewer/lib/features/controls.js';
import {$scene, $renderer} from '@google/model-viewer/lib/model-viewer-base.js';
import {recenteredTarget} from '../src/view-reset.mjs';
import {previewDistances, previewFarClip, previewFov, previewLens, stepZoom, zoomProportion, zoomRadius, zoomTarget} from '../src/space-camera.mjs';
import previewBounds from './preview-bounds.json' with {type:'json'};

export function configureSpaceCamera(viewer, item, thumbnail) {
  const scene = viewer[$scene], scale = scene.model.scale.x;
  const source = {...viewer.originalGltfJson?.extras?.ccpdec, ...item.appearance?.extras?.ccpdec};
  const hull = item.dna?.split(':')[0]?.toLowerCase();
  const turret = viewer.equipmentPreview && (viewer.equipmentPreview.boundingSphere ?? previewBounds.turrets[item.dna]);
  const hullSphere = previewBounds.hulls[hull];
  const center = viewer.getBoundingBoxCenter();
  const sphereCenter = turret ? [turret[0], Math.max(2, turret[1]), turret[2]] : source.sourceCenter ?? hullSphere?.slice(0, 3);
  const locatorSets = item.locatorSets || source.locatorSets || [];
  const offset = locatorSets.find(set => set.name === 'camera_look_at')?.locators?.[0]?.[0] ??
    previewBounds.lookAt[hull] ?? sphereCenter ?? [center.x / scale, center.y / scale, center.z / scale];
  const authoredRadius = turret?.[3] ?? source.sourceRadius ?? hullSphere?.[3];
  const radius = authoredRadius > 0 ? authoredRadius : scene.boundingSphere.radius / scale;
  const {near, far, home} = previewDistances(radius, offset);
  const distance = thumbnail?.distance ?? home * scale;
  // PrepareSpaceScene resets the eye halfway between the base camera's
  // 100 and 10000 metre limits before SetupSpaceCamera assigns the look-at point.
  const eye = new Vector3(0, 500, 1000).setLength((100 + 10000) / 2);
  const focus = new Vector3(...offset);
  const initial = new Spherical().setFromVector3(eye.sub(focus));
  const phi = thumbnail ? MathUtils.degToRad(thumbnail.polar) : initial.phi;
  const theta = thumbnail ? MathUtils.degToRad(thumbnail.azimuth) : initial.theta;
  const maxPitch = viewer.equipmentPreview ? Math.PI / 2 - 0.1 : Math.PI - 0.05;
  focus.multiplyScalar(scale);
  viewer.spaceCamera = {
    scale, orbit: `${theta}rad ${phi}rad ${distance}m`,
    focus, target: focus.toArray().map(x => x + 'm').join(' '), lens: thumbnail?.fov ?? previewLens,
    near: near * scale, far: far * scale,
  };
  viewer.dataset.homeDistance = String(distance);
  // Very large objects can straddle the far plane. Keep the client's signed
  // distance endpoints for zoom; SmoothControls needs ordered, unsigned limits.
  viewer.setAttribute('min-camera-orbit', `auto 0.05rad ${Math.min(Math.max(0, Math.min(near, far)) * scale, distance)}m`);
  viewer.setAttribute('max-camera-orbit', `auto ${maxPitch}rad ${Math.max(near * scale, Math.abs(far) * scale, distance)}m`);
  viewer.cameraTarget = viewer.spaceCamera.target;
  viewer.cameraOrbit = viewer.spaceCamera.orbit;
  viewer.fieldOfView = viewer.spaceCamera.lens + 'deg';
}

export function installViewerZoom(viewer, controls) {
  const scene = viewer[$scene];
  const original = controls.adjustOrbit;
  const resetRadius = controls.resetRadius;
  const adjustedFoV = scene.adjustedFoV, updateNearFar = controls.updateNearFar;
  const dampRadius = controls.radiusDamper.update;
  let wheel;
  scene.adjustedFoV = function(degrees) {
    return viewer.hangarActive ? adjustedFoV.call(this, degrees) : previewFov(degrees, this.aspect);
  };
  controls.updateNearFar = function(near, far) {
    if (!viewer.spaceCamera || viewer.hangarActive) return updateNearFar.call(this, near, far);
    const {scale} = viewer.spaceCamera;
    this.camera.near = scale;
    this.camera.far = previewFarClip * scale;
    this.camera.updateProjectionMatrix();
  };
  controls.adjustOrbit = function(theta, phi, zoom) {
    original.call(this, theta, phi, 0);
    if (!zoom || !viewer.spaceCamera || viewer.hangarActive) return;
    const range = viewer.spaceCamera;
    const near = range.near > range.far ? range.near : this.options.minimumRadius;
    const far = range.near > range.far ? range.far : this.options.maximumRadius;
    const moving = wheel && wheel.goal === this.goalSpherical.radius && wheel.near === near && wheel.far === far;
    const current = moving ? wheel.position : zoomProportion(this.spherical.radius, near, far);
    const p = moving ? wheel.target : current;
    if ((zoom < 0 && p === 0) || (zoom > 0 && p > 1 - 1e-5)) return;
    // One model-viewer keyboard zoom unit is 0.04; one native wheel notch is 120.
    const target = zoomTarget(p, zoom * 120 / 0.04, near, far);
    if (target === p) return;
    this.setOrbit(undefined, undefined, Math.abs(zoomRadius(target, near, far)));
    wheel = {near, far, position:current, target, goal:this.goalSpherical.radius};
  };
  controls.radiusDamper.update = function(current, goal, milliseconds, normalization) {
    if (!wheel || goal !== wheel.goal || viewer.hangarActive || current === goal) {
      wheel = undefined;
      return dampRadius.call(this, current, goal, milliseconds, normalization);
    }
    wheel.position = stepZoom(wheel.position, wheel.target, milliseconds / 1000);
    const radius = zoomRadius(wheel.position, wheel.near, wheel.far);
    if (radius < 0) {
      // SetEyePosition places the eye on the opposite side of the focus.
      controls.spherical.theta += Math.PI;
      controls.goalSpherical.theta += Math.PI;
      controls.spherical.phi = Math.PI - controls.spherical.phi;
      controls.goalSpherical.phi = Math.PI - controls.goalSpherical.phi;
    }
    if (wheel.position !== wheel.target) return Math.abs(radius);
    wheel = undefined;
    return goal;
  };
  // SmoothControls normally reanchors the target in depth after a two-finger
  // pan/pinch. Keep the target's pan plane so releasing the gesture cannot dolly.
  controls.resetRadius = function() {
    if (this.touchMode !== this.touchModeZoom) resetRadius.call(this);
  };
  return () => {
    controls.adjustOrbit = original;
    controls.resetRadius = resetRadius;
    scene.adjustedFoV = adjustedFoV;
    controls.updateNearFar = updateNearFar;
    controls.radiusDamper.update = dampRadius;
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
export async function waitForFrame(viewer, signal) {
  await viewer.updateComplete;
  const scene = viewer[$scene], previous = scene.renderCount;
  scene.queueRender();
  // A completed asset load does not mean the restored camera/materials have
  // reached the screen. Wait for the renderer, not an arbitrary delay.
  while (viewer.isConnected && !signal?.aborted && scene.renderCount === previous) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}
export function captureView(viewer) {
  const orbit = viewer.getCameraOrbit(), camera = viewer.spaceCamera;
  return {orbit, target:viewer.getCameraTarget(), fov:viewer.getFieldOfView(), yaw:viewer[$scene].yaw,
    linearZoom:camera && camera.far !== camera.near ? (orbit.radius - camera.near) / (camera.far - camera.near) : 0.5,
    center:camera?.focus ?? viewer[$scene].boundingBox.getCenter(new Vector3())};
}
export async function restoreView(viewer, view, {recenter = false} = {}) {
  const {orbit, target, yaw} = view;
  const camera = viewer.spaceCamera;
  const radius = recenter && camera && Number.isFinite(view.linearZoom)
    ? camera.near + MathUtils.clamp(view.linearZoom, 0, 1) * (camera.far - camera.near) : orbit.radius;
  viewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${radius}m`;
  viewer.cameraTarget = `${target.x}m ${target.y}m ${target.z}m`;
  viewer.resetTurntableRotation(yaw);
  await viewer.updateComplete;
  viewer.jumpCameraToGoal();
  if (recenter) return recenteredTarget(view, camera?.focus ?? viewer[$scene].boundingBox.getCenter(new Vector3()));
}
