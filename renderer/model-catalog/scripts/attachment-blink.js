/*! Timing adapted from EveSpaceObjectAttachmentUtils.cpp, © 2024 CCP ehf., MIT. */
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EveSpaceObjectAttachmentUtils.cpp#L9-L80
export const flashPulse = `
float flashPulse(float cycle, float rate) {
  float peak = 0.05 * rate;
  float end = 4.0 * peak;
  if (peak < 0.0001) peak = 1.0;
  if (cycle < peak) return cycle / peak;
  if (cycle < end) return (end - cycle) / (end - peak);
  return 0.0;
}`;

// Trinity uses Fade for the light associated with a SOF plane. The viewer uses
// that published timing for the plane itself as well. Duty cycle is reserved.
export const planeFade = flashPulse + `
float planeFade(vec4 blink, float seconds) {
  float rate = blink.x, phase = blink.y, whole;
  int mode = int(blink.w);
  if (mode == 1) {
    if (rate == 0.0) return 0.0;
    return flashPulse(modf(seconds * rate + phase, whole), rate);
  }
  if (mode == 2 || mode == 3) {
    float ramp = modf((seconds + phase) * rate, whole);
    return mode == 2 ? ramp : 1.0 - ramp;
  }
  if (mode == 4) {
    float cycle = modf(seconds * rate, whole) + phase;
    return 0.5 + 0.5 * sin(6.28318530718 * cycle);
  }
  return 1.0;
}`;
