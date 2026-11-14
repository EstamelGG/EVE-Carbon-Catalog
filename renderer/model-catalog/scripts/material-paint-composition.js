// Segment 10: original coverage blending and public dielectric/gloss equations.
// See material-surface-policy.js. Source mask channel and environment opt-out
// are local asset adapters, not claims about the missing Carbon shader.
// Paint mask is needed before layer overrides; final paint is applied after them.
export const paintMask = (environment) => environment ? '0.0' : 'clamp(texture2D(eve_PaintMaskMap,eveUV).r*eve_paint,0.0,1.0)*eve_usePaintMaskMap';

export function paintComposition(patterns) {
  return `diffuseColor.rgb=clamp(eveAlbedo*mix(eveBaseDiffuse,vec3(1.0),evePaint),0.0,1.0);
vec3 eveRuntimeF0=evePaintFresnel(eveBaseFresnel,evePaint);
float eveRough=mix(1.0,texture2D(eve_RoughnessMap,eveUV).r,eve_useRoughnessMap);
float eveAlpha=eveSurfaceAlpha(dot(eveW,${patterns ? 'eveGloss' : 'eve_gloss'}),eveRough,evePaint);
`;
}
