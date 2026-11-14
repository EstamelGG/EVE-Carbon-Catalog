/*!
 * Distance window / inverse-square falloff adapted from Three.js r183,
 * src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js, MIT:
 * https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js
 * Copyright © 2010-2026 three.js authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Local source-asset convention, not photometric intensity:
// - Measure distance in units of the authored outer radius (scale invariant).
// - A small source has attenuation 1 at half the outer radius. The factor is
//   1 / ((1 - .5^4)^2 / .5^2) = 64/225, not a fitted client constant.
// - The source inner radius also bounds the inverse-square core. This is a
//   simple local finite-core approximation, not Carbon GetBoundedAttenuation.
// - The public .01 squared-distance floor is in these normalized units.
// There is no inherited (1-fuzz) dimming or radius-minus-distance expression.
export const pointAttenuationDeclarations = `
float eveSourceDistanceAttenuation(float distanceToLight, float outerRadius, float innerRadius) {
  if (outerRadius <= 0.0 || distanceToLight >= outerRadius) return 0.0;
  float distanceRatio = distanceToLight / outerRadius;
  float coreRatio = max(innerRadius, 0.0) / outerRadius;
  float squaredDistance = distanceRatio * distanceRatio;
  float window = max(1.0 - squaredDistance * squaredDistance, 0.0);
  float boundedDistance = max(max(squaredDistance, coreRatio * coreRatio), 0.01);
  return (64.0 / 225.0) * window * window / boundedDistance;
}
`;
