import {shellFacing} from './gate-shell-facing.js';
import {layerCoordinates} from './layered-mesh-material.js';

// CCP's four-layer Main binding table places both profiles and all UV transforms
// in the vertex stage. The pixel stage receives just the two color constants.
// The layer pairing is a viewer policy. Each mask gates its texture pair.
export const fourLayerInputs = `
uniform float time;
uniform vec4 FresnelFactors1, FresnelFactors2;
uniform vec4 TextureTransform1, TextureTransform2, TextureTransform3, TextureTransform4;
uniform vec4 TextureScroll1, TextureScroll2, TextureScroll3, TextureScroll4;
out vec2 layerGains;
out vec4 firstPairUV, secondPairUV;
${shellFacing}
${layerCoordinates}`;

export const fourLayerCoordinates = `
layerGains = vec2(shellIntensity(facing, FresnelFactors1), shellIntensity(facing, FresnelFactors2));
firstPairUV = vec4(layerUV(uv, TextureTransform1, TextureScroll1), layerUV(uv, TextureTransform2, TextureScroll2));
secondPairUV = vec4(layerUV(uv, TextureTransform3, TextureScroll3), layerUV(uv, TextureTransform4, TextureScroll4));`;

export function fourLayerFragment(record) {
  const maps = record.textures || {};
  const sample = (name, uv) => maps[name] ? `texture(${name}, ${uv})` : 'vec4(1.0)';
  return `
in vec2 gateUV, layerGains;
in vec4 firstPairUV, secondPairUV;
uniform vec4 DiffuseColor1, DiffuseColor2;
${['MaskMap1','MaskMap2','DiffuseMap1','DiffuseMap2','DiffuseMap3','DiffuseMap4']
    .filter(k => maps[k]).map(k => `uniform sampler2D ${k};`).join('\n')}
out vec4 fragColor;
void main() {
  vec4 first = ${sample('MaskMap1', 'gateUV')} * ${sample('DiffuseMap1', 'firstPairUV.xy')} * ${sample('DiffuseMap2', 'firstPairUV.zw')};
  vec4 second = ${sample('MaskMap2', 'gateUV')} * ${sample('DiffuseMap3', 'secondPairUV.xy')} * ${sample('DiffuseMap4', 'secondPairUV.zw')};
  // Separate emitted radiance from surface opacity: alpha-zero HDR layers
  // can emit light. The nearer sheet attenuates the background with its
  // Porter-Duff transmittance, including in a transparent draw.
  vec3 back = first.rgb * DiffuseColor1.rgb * layerGains.x;
  vec3 front = second.rgb * DiffuseColor2.rgb * layerGains.y;
  float backOpacity = clamp(first.a*DiffuseColor1.a*layerGains.x,0.0,1.0);
  float frontOpacity = clamp(second.a*DiffuseColor2.a*layerGains.y,0.0,1.0);
  fragColor = vec4(front + (1.0-frontOpacity)*back, frontOpacity + (1.0-frontOpacity)*backOpacity);
  ${record.blend === 'additiveAreas' ? 'fragColor.a = 0.0;' : ''}
}`;
}
