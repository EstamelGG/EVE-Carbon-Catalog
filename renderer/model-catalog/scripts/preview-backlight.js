/*!
 * Normalized cosine-power kernel adapted from PBRT v2 Blinn::D,
 * src/core/reflection.h at e6f6334f3c26ca29eba2b27af4e60fec9fdc7a8d.
 * https://github.com/mmp/pbrt-v2/blob/e6f6334f3c26ca29eba2b27af4e60fec9fdc7a8d/src/core/reflection.h#L394
 * pbrt source code Copyright(c) 1998-2012 Matt Pharr and Greg Humphreys.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 * - Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

// Application policy: a camera-facing preview lobe modulates the sampled cube.
// This reuses a public normalized shape, not PBRT's complete microfacet BRDF or
// the game's CopyCube implementation. The authored scene supplies tint/exponent.
// For p>=0, integral over the hemisphere of D(cos(theta))*cos(theta) dOmega = 1.
export function previewBacklightKernel(cosine, exponent) {
  if (cosine <= 0) return 0;
  return (exponent + 2) / (2 * Math.PI) * Math.min(cosine, 1) ** exponent;
}

export const previewBacklightDeclarations = `
float evePreviewBacklight(float cosine, float exponent) {
  if (cosine <= 0.0) return 0.0;
  return (exponent + 2.0) / (2.0 * 3.141592653589793) * pow(min(cosine,1.0),exponent);
}
`;
