/*!
 * Fuzz and spot profile adapted from official Carbon Trinity, MIT:
 * https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/DynamicLighting.fxh#L281
 * LinStep: shaders/include/Carbon/Math.fxh. Renamed and ported to GLSL;
 * zero-distance and zero-width cone behavior made explicit below.
 * Copyright © 2026 CCP ehf. Copyright (c) 2026 Fenris Creations.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export const dynamicLightDeclarations = `
float eveSourceRoughnessIncrease(float innerRadius, float distanceToLight) {
  float fuzz = distanceToLight > 0.0 ? clamp(innerRadius / distanceToLight, 0.0, 0.8)
    : (innerRadius > 0.0 ? 0.8 : 0.0);
  float squaredFuzz = fuzz * fuzz;
  return squaredFuzz * squaredFuzz;
}

float eveSourceSpotAttenuation(float outerCosine, float innerCosine, float cosine) {
  if (innerCosine <= outerCosine) return step(outerCosine, cosine);
  float profile = clamp((cosine - outerCosine) / (innerCosine - outerCosine), 0.0, 1.0);
  return profile * profile;
}
`;
