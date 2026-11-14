// The native turntable tick supplies the rotation delta.
// https://github.com/google/model-viewer/blob/adc877c66f97e1498d8b19a8850976aee3d0197f/packages/model-viewer/src/features/staging.ts#L104-L113
// Keep model-viewer's delay, interaction and visibility handling. Ease only
// the turntable movement it actually produces, leaving camera motion alone.
export function smoothAutoRotate(viewer, tick, duration = 2000) {
  const original = viewer[tick];
  let elapsed = 0;
  const reset = () => { elapsed = 0; };
  const integratedSpeed = time => time < duration
    ? time * time / (2 * duration) : time - duration / 2;
  const wrapped = function (time, delta) {
    const before = this.turntableRotation;
    const result = original.call(this, time, delta);
    const movement = this.turntableRotation - before;
    if (!this.autoRotate || movement === 0 || delta <= 0) {
      reset();
      return result;
    }
    if (elapsed < duration) {
      const next = elapsed + delta;
      const gain = (integratedSpeed(next) - integratedSpeed(elapsed)) / delta;
      this.resetTurntableRotation(before + movement * gain);
      elapsed = next;
    }
    return result;
  };
  const onCameraChange = event => {
    if (event.detail.source === 'user-interaction') reset();
  };
  viewer[tick] = wrapped;
  viewer.addEventListener('camera-change', onCameraChange);
  return () => {
    if (viewer[tick] === wrapped) viewer[tick] = original;
    viewer.removeEventListener('camera-change', onCameraChange);
  };
}
