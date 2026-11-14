// The affine UV transform follows the Texture.matrix convention in Three.
// https://threejs.org/docs/pages/Texture.html#matrix
// Axis behavior and emission curves are independent fits to rendered web
// samples, documented in docs/source-remediation-41-evidence.json.
export function setGlowUV(matrix, rates, offsets, seconds) {
  const [u, v, spin] = rates;
  const phase = (speed, offset) => {
    const cycles = Math.fround(Math.fround(Math.fround(seconds) * speed) + offset);
    return cycles - Math.floor(cycles);
  };
  // A positive rate selects a single moving strip of the source texture.
  // A negative rate repeats the pattern twice and pans it backwards.
  const width = 1 - Math.sign(u), height = 1 - Math.sign(v);
  const left = Math.sign(u) * phase(u, offsets[0]) - 0.5;
  const bottom = Math.sign(v) * phase(v, offsets[1]) - 0.5;
  const angle = Math.fround(Math.fround(seconds) * spin);
  const c = Math.cos(angle), s = Math.sin(angle);
  return matrix.set(
    c * width, -s * height, 0.5 + c * left - s * bottom,
    s * width, c * height, 0.5 + s * left + c * bottom,
    0, 0, 1,
  );
}

export const glowDecalFragment = `
in vec2 projected;
out vec4 fragColor;
uniform sampler2D transparencyMap, glowMap;
uniform mat3 glowUV;
uniform vec3 emissionColor;
uniform float intensity;

void main() {
  if (max(abs(projected.x), abs(projected.y)) > 1.0) discard;
  vec2 surfaceUV = 0.5 * projected + 0.5;
  vec2 lightUV = (glowUV * vec3(surfaceUV, 1.0)).xy;
  float coverage = texture(transparencyMap, surfaceUV).r * intensity;
  float light = pow(texture(glowMap, lightUV).r, 2.4);
  fragColor = vec4(emissionColor * (coverage * coverage * light), 0.0);
}
`;
