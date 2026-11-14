/*!
 * Carbon Trinity TriMath.cpp (TriPerlinNoise and PerlinNoise1D).
 * https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity
 * MIT License
 *
 * Copyright © 2023 CCP ehf.
 * Copyright (c) 2026 Fenris Creations
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// Fixed gradients from the first 256 outputs of std::mt19937(0), modulo 512 minus 256.
const gradients = [
  -84, -209, -139, -64, 67, -5, -61, 103, -247, -45, 21, -14, 36, -169, -186, 216,
  -168, 140, 58, -63, 230, -217, -169, -82, -168, 81, -91, -231, 77, -184, 9, 148,
  -141, 208, -13, -59, 254, 79, 175, 192, 82, -157, 216, -79, -13, 29, -109, -109,
  142, 167, 32, 193, 9, -71, -129, -224, -225, -54, -12, -105, -93, 254, 203, 114,
  -73, -228, 34, -128, -128, 164, -203, 133, -218, 232, -12, 17, 79, 132, -151, -214,
  186, -225, 120, 1, 65, 231, 169, -199, 35, 102, -137, 11, 174, -174, -165, 128,
  142, -157, -203, 140, -135, 170, -172, -53, 68, 6, 196, -209, -129, 244, -125, 204,
  100, -76, 232, 78, -113, -108, -29, 186, 23, -49, 141, 117, 85, -208, 49, -187,
  -87, -93, 192, -161, -59, -162, 0, 113, -78, 36, 162, 48, 93, 131, -158, -214,
  205, 112, 231, 149, -55, 127, -256, 138, 114, -213, 186, 127, -233, -69, -126, 121,
  -158, -194, 163, -34, -133, 195, -174, 174, -29, -108, -47, -206, 155, 14, -215, -198,
  -63, -220, 10, -170, -213, 104, -245, 2, 51, -176, -224, -74, -128, 38, 19, -82,
  -214, 115, -72, 188, 232, -179, 30, 24, -131, 2, -253, -162, -30, 107, 13, 112,
  40, 72, -237, -161, 72, 154, 194, -8, -76, 67, 236, 61, 14, 96, 4, 195,
  -19, -117, 252, -170, 205, 121, -147, 75, -72, -240, -104, 157, -107, -146, -231, 208,
  188, 121, 118, -139, 189, -173, -95, 104, 160, -28, 251, -5, -135, 70, 213, 31,
];

export function perlinNoise1D(x, inverseAmplitude, frequency, octaves) {
  const count = Math.trunc(octaves), amplitudeScale = 1 / inverseAmplitude;
  let weight = 1, sum = 0;
  for (let octave = 0; octave < count; octave++) {
    const cell = Math.floor(x), t = x - cell;
    const left = t * gradients[cell & 255] / 256;
    const right = (t - 1) * gradients[(cell + 1) & 255] / 256;
    sum += weight * (left + t * t * (3 - 2 * t) * (right - left));
    x *= frequency;
    weight *= amplitudeScale;
  }
  return sum;
}
