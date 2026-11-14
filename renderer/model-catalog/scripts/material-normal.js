// The builder publishes NormalMap directly as glTF normalTexture. Its RGB
// channels encode XYZ in linear space. Three r183 normal_fragment_maps applies
// the tangent frame and normalScale afterwards.
// https://github.com/KhronosGroup/glTF/blob/51fde5dc47ac3178594e58a548f936e2910a8239/specification/2.0/Specification.adoc#additional-textures-normal
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/normal_fragment_maps.glsl.js
import {hasDetail} from './detail-material.js';
import {hasEnvironment} from './environment-material.js';

export const normalDeclarations = `
vec3 eveTangentNormal(vec3 rgb, vec3 detailOffset) {
  vec3 direction = rgb * 2.0 - 1.0 + detailOffset;
  // The glTF normal faces outwards. Quantization at the horizon can yield
  // byte 127; collapse that small undershoot to the tangent plane.
  direction.z = max(direction.z, 0.0);
  float lengthSquared = dot(direction, direction);
  return lengthSquared > 0.0 ? direction * inversesqrt(lengthSquared) : vec3(0.0, 0.0, 1.0);
}
`;

// Extra maps carry signed perturbations around mid-gray. Applying their
// authored offsets before normalization is a project policy. Family-specific
// selectors and UVs still belong to the respective material adapters.
export function normalExpression(native, sampler = 'normalMap', uv = 'vNormalMapUv') {
  let offset = 'vec3(0.0)';
  if (hasEnvironment(native)) {
    uv += '*eve_GeneralTiling.y';
    offset = 'eveEnvironmentNormal';
  } else if (hasDetail(native)) {
    offset = 'eveDetailNormal';
  }
  return `eveTangentNormal(texture2D(${sampler},${uv}).rgb,${offset})`;
}
