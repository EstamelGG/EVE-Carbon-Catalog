import {environmentMipDeclarations} from './carbon-environment-map.js';
import {previewBacklightDeclarations} from './preview-backlight.js';

// Viewer sampling adapter. Input scene fields are independently built from
// BLACK by reflection_assets.py; cube coordinates use the authored inverse
// rotation. Camera-facing tint is explicitly a preview appearance policy.
export const reflectionDeclarations = `
uniform samplerCube eve_reflectionCube, eve_diffuseCube;
uniform float eve_reflectionMips, eve_backlightContrast;
uniform bool eve_diffuseFromReflection;
uniform float eve_diffuseRoughness;
uniform vec3 eve_backlight;
uniform mat3 eve_cubeRotation;
${environmentMipDeclarations}
${previewBacklightDeclarations}
vec3 eveCubeDirection(vec3 viewDirection) {
  return eve_cubeRotation * normalize(viewDirection * mat3(viewMatrix));
}
vec3 eveEnvironment(vec3 direction, float roughness) {
  vec3 radiance = textureLod(eve_reflectionCube, eveCubeDirection(direction),
    eveEnvironmentMip(roughness,eve_reflectionMips)).rgb;
  float lobe = evePreviewBacklight(-normalize(direction).z, eve_backlightContrast);
  return radiance * (vec3(1.0) + eve_backlight*lobe);
}
vec3 eveDiffuseEnvironment(vec3 direction) {
  // Two supported asset contracts: separate authored diffuse cube, or one
  // cube with an explicit diffuse LOD. This branch does not infer a game shader.
  vec3 cubeDirection = eveCubeDirection(direction);
  if (eve_diffuseFromReflection)
    return textureLod(eve_reflectionCube, cubeDirection,
      eveEnvironmentMip(eve_diffuseRoughness,eve_reflectionMips)).rgb * eve_environmentStrength;
  return textureLod(eve_diffuseCube,cubeDirection,0.0).rgb;
}
`;
