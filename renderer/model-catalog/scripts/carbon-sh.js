/*!
 * L2 projection/packing adapted from carbonengine/trinity, Tr2ShLightingManager.cpp
 * f644516ae4f921f6f3a3e58dc5d19107781571ec, ShSolver<L2>.
 * https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Tr2ShLightingManager.cpp
 * Copyright © 2014 CCP ehf.
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

const sqrtPi = Math.sqrt(Math.PI);
// Retain the published table's 0.3141593E1 constant. JavaScript evaluates in
// double precision; this is a formula port, not DirectX SIMD bit emulation.
const basisPi = Math.sqrt(3.141593);
const linearNormalization = 2 / 3 * Math.sqrt(3 * Math.PI) * 0.488602511902919920 * Math.sqrt(3) * basisPi / 2;
const quadraticNormalization = 2 / 5 * Math.sqrt(5 * Math.PI) * (-Math.sqrt(5) * basisPi / 2);
const normalization = [
  2 * sqrtPi * 0.282094791773878140 * basisPi,
  -linearNormalization, linearNormalization, -linearNormalization,
  ...[0.546274215296039590, -1.092548430592079200, -0.315391565252520050,
      -1.092548430592079200, 0.546274215296039590].map(value => value * quadraticNormalization),
];

// SHEvalSphericalLight + ComputeCapInt + EvalBasis. Direction is unit length;
// distance and radius use the same units. Source selection is the caller's job.
export function projectSphericalLight([x, y, z], distance, radius) {
  const sinAngle = distance <= radius ? 1 : radius / distance;
  const cosAngle = distance <= radius ? 0 : Math.sqrt(1 - sinAngle * sinAngle);
  const cap = [1 - cosAngle, sinAngle * sinAngle, cosAngle * (cosAngle * cosAngle - 1)];
  const basis = [1, y, z, x, x * y + y * x, z * y, 3 * z * z - 1, z * x, x * x - y * y];
  return basis.map((value, index) => value * cap[index === 0 ? 0 : index < 4 ? 1 : 2]);
}

// CalculateSecondaryLighting accumulation for purely emissive sources, followed
// by NormalizeShCoefficients. No scene thresholds or secondary bounce simulation.
export function sphericalLightCoefficients(lights, intensity) {
  const coefficients = Array.from({length: 9}, () => [0, 0, 0]);
  for (const {direction, distance, radius, color} of lights) {
    const projection = projectSphericalLight(direction, distance, radius);
    for (let index = 0; index < 9; index++)
      for (let channel = 0; channel < 3; channel++)
        coefficients[index][channel] += projection[index] * color[channel];
  }
  return coefficients.map((rgb, index) => rgb.map(value => value * normalization[index] * intensity));
}

// PackCoefficients: RGB linear/constant rows, RGB quadratic rows, final x²-y² row.
export function packSH(coefficients) {
  const c0 = 1 / (2 * sqrtPi), c1 = Math.sqrt(3) / (3 * sqrtPi);
  const c2 = Math.sqrt(15) / (8 * sqrtPi), c3 = Math.sqrt(5) / (16 * sqrtPi);
  const packed = [];
  for (let channel = 0; channel < 3; channel++)
    packed.push([-c1 * coefficients[3][channel], -c1 * coefficients[1][channel],
      c1 * coefficients[2][channel], c0 * coefficients[0][channel] - c3 * coefficients[6][channel]]);
  for (let channel = 0; channel < 3; channel++)
    packed.push([c2 * coefficients[4][channel], -c2 * coefficients[5][channel],
      3 * c3 * coefficients[6][channel], -c2 * coefficients[7][channel]]);
  packed.push([...coefficients[8].map(value => value * c2 / 2), 1]);
  return packed;
}

// Original GLSL implementation of the polynomial implied by PackCoefficients.
// Include the constant component so an isotropic light field stays direction independent.
export const packedSHPolynomial = `
vec3 carbonPackedSH(vec4 coefficients[7], vec3 n) {
  vec4 linearTerms = vec4(n, 1.0);
  vec4 quadraticTerms = vec4(n.x*n.y, n.y*n.z, n.z*n.z, n.x*n.z);
  vec3 linear = vec3(dot(coefficients[0],linearTerms),
    dot(coefficients[1],linearTerms), dot(coefficients[2],linearTerms));
  vec3 quadratic = vec3(dot(coefficients[3],quadraticTerms),
    dot(coefficients[4],quadraticTerms), dot(coefficients[5],quadraticTerms));
  return linear + quadratic + coefficients[6].rgb * (n.x*n.x - n.y*n.y);
}
`;
