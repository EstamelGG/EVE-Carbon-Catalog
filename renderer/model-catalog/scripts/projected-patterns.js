// SOURCE AUDIT 2026-11-11 [M04]: Official source supports inverse SRT and mask metadata only; pixel blend/capability rules remain unverified.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
// Reference: https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Utils/EveCustomMask.cpp
import { Matrix4, Quaternion, Vector3, Vector4 } from 'three';

// Resolve the sampler independently of the projection's array position. Legacy
// records without a role used consecutive slots. Emit only known GLSL names.
export function patternRoles(native) {
  return (native.patterns || []).map((mask, index) => {
    const role = mask.role ?? `PatternMask${index + 1}Map`;
    if (role !== 'PatternMask1Map' && role !== 'PatternMask2Map')
      throw new Error('Unsupported projected texture role: ' + role);
    return role;
  });
}

export function patternUniforms(native) {
  const result = {};
  for (const [i, mask] of (native.patterns || []).entries()) {
    const prefix = mask.materialIndex < 4 ? `Mtl${mask.materialIndex+1}` : `PMtl${mask.materialIndex-3}`;
    const matrix = new Matrix4().compose(new Vector3(...mask.position),
      new Quaternion(...mask.rotation).normalize(), new Vector3(...mask.scaling)).invert();
    const p = native.parameters;
    Object.assign(result, {
      [`eve_projection${i}`]: {value:matrix},
      [`eve_mirror${i}`]: {value:Number(mask.isMirrored)},
      [`eve_clamp${i}`]: {value:new Vector4(Number(mask.clampU),Number(mask.clampV),0,0)},
      [`eve_border${i}`]: {value:new Vector4(Number(mask.addressU===4),Number(mask.addressV===4),0,0)},
      [`eve_targets${i}`]: {value:new Vector4(...mask.targetMaterials)},
      [`eve_patternDiffuse${i}`]: {value:new Vector3(...p[prefix+'DiffuseColor'].slice(0,3))},
      [`eve_patternFresnel${i}`]: {value:new Vector3(...p[prefix+'FresnelColor'].slice(0,3))},
      [`eve_patternGloss${i}`]: {value:p[prefix+'Gloss'][0]},
    });
  }
  return result;
}

// Project in undeformed authoring coordinates. The pattern stays attached as the hull animates.
// GPU and independent geometric checks: docs/source-remediation-182-evidence.json.
export function patternVertex(count) {
  return {
    declarations: 'attribute vec3 _ccp_source_position;\n' + Array.from({length:count},(_,i)=>`
uniform mat4 eve_projection${i};
uniform float eve_mirror${i};
varying vec2 eve_projectionUV${i};`).join('\n'),
    body: Array.from({length:count},(_,i)=>`
vec3 eve_rest${i}=_ccp_source_position;
eve_rest${i}.x=mix(eve_rest${i}.x,abs(eve_rest${i}.x),eve_mirror${i});
eve_projectionUV${i}=(eve_projection${i}*vec4(eve_rest${i},1.0)).yz*0.5+0.5;`).join('\n'),
  };
}

function samplers(count, roles) {
  return Array.from({length:count}, (_, i) => roles[i] ?? `PatternMask${i+1}Map`);
}

// WebGL2 omits CLAMP_TO_BORDER. Reconstruct the zero border at each mip
// before trilinear filtering. Ordinary wrapped/clamped samplers retain hardware filtering.
const borderSampling = `
float eveBorderMip(sampler2D tex, vec2 uv, vec2 edge, float level) {
  vec2 size = vec2(textureSize(tex, int(level)));
  vec2 halfTexel = 0.5 / size;
  vec2 st = mix(uv, clamp(uv, halfTexel, 1.0-halfTexel), edge);
  vec2 coverage = clamp(min(uv, 1.0-uv)*size+0.5, 0.0, 1.0);
  coverage = mix(vec2(1.0), coverage, edge);
  return textureLod(tex,st,level).r * coverage.x * coverage.y;
}
float evePatternSample(sampler2D tex, vec2 uv, vec2 edge, vec2 clampAxes) {
  if (edge.x + edge.y == 0.0)
    return textureGrad(tex, mix(uv,clamp(uv,0.0,1.0),clampAxes), dFdx(uv), dFdy(uv)).r;
  vec2 size = vec2(textureSize(tex,0));
  vec2 dx = dFdx(uv)*size, dy = dFdy(uv)*size;
  float maxLevel = floor(log2(max(size.x,size.y)));
  float level = clamp(0.5*log2(max(1.0,max(dot(dx,dx),dot(dy,dy)))),0.0,maxLevel);
  vec2 st = mix(uv,clamp(uv,0.0,1.0),clampAxes*(1.0-edge));
  float lo=floor(level);
  return mix(eveBorderMip(tex,st,edge,lo),eveBorderMip(tex,st,edge,min(lo+1.0,maxLevel)),fract(level));
}`;

export function patternDeclarations(count, roles = []) {
  const textures = [...new Set(samplers(count, roles))].map(role => `uniform sampler2D eve_${role};`);
  return (count ? borderSampling : '') + textures.join('\n') + Array.from({length:count},(_,i)=>`
varying vec2 eve_projectionUV${i};
uniform vec4 eve_clamp${i},eve_border${i},eve_targets${i};
uniform vec3 eve_patternDiffuse${i},eve_patternFresnel${i};
uniform float eve_patternGloss${i};`).join('\n');
}

export function patternComposition(count, roles = []) {
  return `vec3 eveDiffuse[4],eveFresnel[4];
vec4 eveGloss=eve_gloss;
for(int i=0;i<4;i++){eveDiffuse[i]=eve_diffuse[i];eveFresnel[i]=eve_fresnel[i];}
` + samplers(count, roles).map((role,i)=>`
float eve_pattern${i}=eve_use${role}*evePatternSample(eve_${role},eve_projectionUV${i},eve_border${i}.xy,eve_clamp${i}.xy);
// The default overlay mode samples both masks independently. Disjoint
// paint regions (including the AT XX prize hulls) must retain layer 2.
vec4 eve_pw${i}=eve_targets${i}*eve_pattern${i};
for(int i=0;i<4;i++){
 eveDiffuse[i]=mix(eveDiffuse[i],eve_patternDiffuse${i},eve_pw${i}[i]);
 eveFresnel[i]=mix(eveFresnel[i],eve_patternFresnel${i},eve_pw${i}[i]);
 eveGloss[i]=mix(eveGloss[i],eve_patternGloss${i},eve_pw${i}[i]);
}`).join('\n');
}
