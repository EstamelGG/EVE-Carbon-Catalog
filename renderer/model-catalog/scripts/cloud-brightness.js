// CCP Trinity, MIT. The BLACK exporter resolves Tr2CurveScalar key tangents.
// It emits only curves with a clamped start and a cycling end.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Curves/Tr2CurveScalar.cpp
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Curves/Tr2CurveScalarExpression.cpp
import {perlinNoise1D} from './trinity-noise.js';

export function scalarInput(keys, seconds) {
  const last = keys.at(-1);
  if (seconds <= 0) return keys[0][1];
  const time = seconds > last[0] ? seconds % last[0] : seconds;
  if (time >= last[0]) return last[1];
  const index = keys.findIndex(key => key[0] > time);
  const [leftTime, left, , outgoing, mode] = keys[index - 1];
  const [rightTime, right, incoming] = keys[index];
  if (mode === 0) return left;
  const duration = rightTime - leftTime;
  const u = (time - leftTime) / duration;
  if (mode === 1) return left + (right - left) * u;
  const v = 1 - u;
  return (1 + 2 * u) * v * v * left + u * v * v * outgoing * duration
    + u * u * (3 - 2 * u) * right - u * u * v * incoming * duration;
}

export function cloudBrightness(controller, elapsed) {
  const time = Math.fround(elapsed * controller.clockScale);
  // The official expressionCurveFakeRandom setting fixes the random constant
  // at 0.21. Use that preview mode so rebuilding a cloud preserves its phase.
  const noise = (perlinNoise1D(time + Math.fround(0.21), 2, 2, 2) + 1) / 2;
  const [first, second] = controller.inputs;
  return controller.scale * noise * scalarInput(first, time) * scalarInput(second, time) + controller.offset;
}
