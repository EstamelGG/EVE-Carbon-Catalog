// EVE 24.02 build 3724492: SceneContainer.PrepareSpaceScene,
// preview.SetupSpaceCamera and baseCamera.Camera's perspective and zoom methods.
export const previewLens = 180 / Math.PI;
export const previewFarClip = 400000;

export function previewFov(degrees, aspect) {
  return degrees * Math.min(1, 1.6 / (aspect > 0 ? aspect : 1));
}

// Work in EVE metres here. The viewer scales each hull for display.
export function previewDistances(radius, offset) {
  const extent = radius + Math.hypot(...offset);
  const near = extent + 1;
  const far = Math.min(previewFarClip - extent, Math.max(1, 2 * extent / Math.tan(0.5)));
  return {near, far, home: (near + far) / 2};
}

export function zoomProportion(radius, near, far) {
  const linear = far === near ? 0 : (Math.max(near, radius) - near) / (far - near);
  return zoomTarget(Math.max(0, linear) ** (1 / 9), 0, near, far);
}

export function zoomRadius(p, near, far) {
  return near + (far - near) * p ** 9;
}

export function zoomTarget(current, delta, near, far) {
  const minimum = far === 0 ? 1 : Math.min(1, 0.2 + near / far);
  return Math.min(1, Math.max(minimum, current + 0.3 * 0.001 * delta));
}

export function stepZoom(current, goal, seconds) {
  const remaining = goal - current;
  const step = 10 * seconds * Math.max(Math.abs(remaining), 1e-5);
  return Math.abs(remaining) <= step ? goal : current + Math.sign(remaining) * step;
}

// DOM wheel pixels/lines have the opposite sign to Windows wheel units.
// Chromium supplies the original signed wheel delta for physical notches.
export function wheelUnits(event) {
  // Synthetic Chromium events may copy deltaY into the legacy field unchanged.
  if (Number.isFinite(event.wheelDeltaY) && event.wheelDeltaY * event.deltaY < 0) return event.wheelDeltaY;
  const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 120 : 1.2;
  return -event.deltaY * unit;
}
