import {Vector3, Vector4, Quaternion} from 'three';
import {sphericalLightCoefficients, packSH, packedSHPolynomial} from './carbon-sh.js';

// Application adapter: the four preview lights are emissive spherical sources,
// sampled at the hull origin. Uniform hull scale cancels in radius/distance.
// This intentionally does not reproduce Trinity's scene light selection/culling
// or reflected secondary sources. The public projection/packing lives separately.
export function previewSH(settings, intensity) {
  const sources = [];
  for (const light of settings.lights) {
    const direction = new Vector3(...light.position);
    for (const transform of [...settings.rigTransforms].reverse())
      direction.applyQuaternion(new Quaternion(...transform.rotation));
    const distance = direction.length();
    if (distance === 0) continue; // No defined direction at the receiver center.
    sources.push({direction: direction.divideScalar(distance).toArray(), distance,
      radius: light.radius, color: light.color.slice(0, 3).map(value => value * light.brightness)});
  }
  return packSH(sphericalLightCoefficients(sources, intensity)).map(row => new Vector4(...row));
}

export const shDeclarations = `
uniform vec4 eve_sh[7];
uniform mat3 eve_shWorld;
uniform float eve_shFill;
${packedSHPolynomial}
vec3 eveSHIrradiance(vec3 direction) {
  vec3 n = normalize((direction * mat3(viewMatrix)) * eve_shWorld);
  return max(carbonPackedSH(eve_sh, n), vec3(0.0)) * eve_shFill;
}
`;
