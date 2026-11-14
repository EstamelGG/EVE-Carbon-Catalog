import {reflectionDeclarations} from './native-reflections.js';
import {shDeclarations} from './native-sh.js';

export function lightingDeclarations(runtime) {
  return `uniform float eve_reflectionStrength;
uniform float eve_ambientStrength, eve_environmentStrength, eve_f0Strength, eve_roughnessScale;
vec3 eve_referenceNormal;
${reflectionDeclarations}
${shDeclarations}
${runtime ? '' : 'uniform sampler2D eve_f0, eve_dust_base, eve_dust_surface;'}
`;
}

// Three r183 lights_fragment_begin routes an irradiance probe to the Lambert
// accumulator. Preconvolved diffuse cube radiance uses the host PI convention
// (envmap_physical_pars_fragment). Only the reflection cube feeds the specular fit.
export const environmentLighting = `
irradiance += eveSHIrradiance(geometryNormal);
iblIrradiance += PI * eveDiffuseEnvironment(geometryNormal);
radiance += eveEnvironment(reflect(-geometryViewDir,geometryNormal),material.roughness*material.roughness)*eve_environmentStrength;
`;

// Linear display gain shared by hulls, glass and projected paint.
export const previewSpecularGain = `
reflectedLight.directSpecular *= eve_reflectionStrength;
reflectedLight.indirectSpecular *= eve_reflectionStrength;
`;
