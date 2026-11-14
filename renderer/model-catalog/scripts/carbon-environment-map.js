/*!
 * RoughnessToGloss / RoughnessToMip adapted from official Carbon Trinity:
 * shaders/include/Carbon/SpaceScene/EnvironmentMap.fxh
 * f644516ae4f921f6f3a3e58dc5d19107781571ec.
 * https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/EnvironmentMap.fxh
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

export function roughnessMip(roughness, levels) {
  let gloss = 1;
  if (roughness >= 0.00052556) {
    const squared = roughness * roughness;
    gloss = Math.log2(2 / (squared * squared) - 1) / 28;
  }
  // Local sampler policy: keep explicit LOD inside the available mip chain.
  return Math.max(0, Math.min(levels - 1, (1 - gloss) * (levels - 1)));
}

export const environmentMipDeclarations = `
float eveEnvironmentMip(float roughness, float levels) {
  float gloss = 1.0;
  if (roughness >= 0.00052556) {
    float squared = roughness * roughness;
    gloss = log2(2.0 / (squared * squared) - 1.0) / 28.0;
  }
  return clamp((1.0-gloss)*(levels-1.0),0.0,levels-1.0);
}
`;
