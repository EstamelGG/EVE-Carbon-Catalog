// First-generation viewer calibration, measured in linear additive radiance.
// The normalized half-peak channel sets the exponent (see section 86).
export const effectColorGLSL = `
vec3 compensateEffectChroma(vec3 radiance) {
  vec3 positive = max(radiance, vec3(0.0));
  float peak = max(max(positive.r, positive.g), positive.b);
  if (peak < 1e-6) return positive;
  float exponent = 1.0 + 1.0 / (2.0 + peak);
  return peak * pow(positive / peak, vec3(exponent));
}
`;

export function withEffectColor(fragmentShader) {
  if (!/\bvoid\s+main\s*\(/.test(fragmentShader)) throw new Error('Missing additive fragment main');
  // A final entry point also covers early returns and helpers declared after main.
  return `${effectColorGLSL}
#define main eveAdditiveSourceMain
${fragmentShader}
#undef main
void main() {
  eveAdditiveSourceMain();
  fragColor.rgb=compensateEffectChroma(fragColor.rgb);
}`;
}
