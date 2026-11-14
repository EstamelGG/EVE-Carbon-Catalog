/*!
 * Reflection-side selection adapted from PBRT v2 BSDF::f:
 * https://github.com/mmp/pbrt-v2/blob/e6f6334f3c26ca29eba2b27af4e60fec9fdc7a8d/src/core/reflection.cpp#L612
 * Changed to a GLSL predicate for an opaque reflection-only material.
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

// Local raster adapter: use Three's nonPerturbedNormal as the reference
// surface. For smooth shading it is an interpolated vertex normal, not
// PBRT's triangle geometric normal. Keeping it unperturbed prevents a normal
// map from admitting light on the opposite side of that reference surface.
// No roughness-dependent leakage, constant 10, or transmission approximation.
// This is NOT a complete shadow-terminator solution or a transmissive BSDF.
export const surfaceReflectionDeclarations = `
bool eveSameReflectionSide(vec3 referenceNormal, vec3 viewDirection, vec3 lightDirection) {
  return dot(referenceNormal, viewDirection) * dot(referenceNormal, lightDirection) > 0.0;
}
`;
