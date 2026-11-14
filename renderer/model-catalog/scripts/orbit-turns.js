// The camera API supplies azimuth in radians.
// https://github.com/google/model-viewer/blob/adc877c66f97e1498d8b19a8850976aee3d0197f/packages/model-viewer/src/features/controls.ts#L271-L280
export function installOrbitTurns(viewer, update, win = viewer.ownerDocument.defaultView) {
  let previous = viewer.getCameraOrbit().theta,
    angle = 0,
    count = 0,
    timer;
  const reset = () => {
    win.clearTimeout(timer);
    timer = undefined;
    angle = 0;
    count = 0;
    update({ count: 0, visible: false });
    previous = viewer.getCameraOrbit().theta;
  };
  function changed(event) {
    const theta = viewer.getCameraOrbit().theta,
      delta = theta - previous;
    previous = theta;
    if (!viewer.hangarActive) {
      reset();
      return;
    }
    if (event.detail?.source !== 'user-interaction' || !Number.isFinite(delta)) return;
    // Camera azimuth may wrap at ±π. Zoom, pan and automatic motion add no turns.
    angle += Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
    const next = Math.floor((angle + 1e-9) / (2 * Math.PI));
    if (next === count) return;
    count = next;
    update({ count, visible: count > 5 });
    win.clearTimeout(timer);
    timer = win.setTimeout(reset, 30000);
  }
  viewer.addEventListener('camera-change', changed);
  viewer.addEventListener('hangar-mode-change', reset);
  reset();
  return () => {
    reset();
    viewer.removeEventListener('camera-change', changed);
    viewer.removeEventListener('hangar-mode-change', reset);
  };
}
