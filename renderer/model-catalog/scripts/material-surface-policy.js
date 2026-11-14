// Original four-stop interpolation and coverage mix, not a recovered Carbon
// shader. Equal stop spacing and paint roughness are explicit local policies.
// IOR -> F0 and gloss -> alpha equations (original implementation):
// https://github.com/KhronosGroup/glTF/blob/51fde5dc47ac3178594e58a548f936e2910a8239/extensions/2.0/Khronos/KHR_materials_ior/README.md#implementation
// https://github.com/KhronosGroup/glTF/blob/51fde5dc47ac3178594e58a548f936e2910a8239/extensions/2.0/Archived/KHR_materials_pbrSpecularGlossiness/README.md#specular---glossiness
// We use the equations, not the archived extension's full material model.
import policy from '../../shared/material-policy.json' with {type: 'json'};

const glsl = value => Number.isInteger(value) ? `${value}.0` : `${value}`;
export const paintF0 = ((policy.paintIOR - 1) / (policy.paintIOR + 1)) ** 2;
export const paintGloss = 1 - policy.paintPerceptualRoughness;
export const surfacePolicyDeclarations = `
vec4 eveWeights(float mask) {
  float position=clamp(mask,0.0,1.0)*3.0;
  return max(vec4(1.0)-abs(vec4(position)-vec4(0.0,1.0,2.0,3.0)),vec4(0.0));
}
vec3 evePaintFresnel(vec3 base,float coverage) {
  return clamp(mix(base,vec3(${glsl(paintF0)}),coverage),0.0,1.0);
}
float eveSurfaceAlpha(float gloss,float textureGloss,float coverage) {
  float roughness=clamp(1.0-mix(gloss*textureGloss,${glsl(paintGloss)},coverage),0.0,1.0);
  return roughness*roughness;
}
`;
