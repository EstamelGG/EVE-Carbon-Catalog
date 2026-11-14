// SOURCE REVIEW: weights replaced by original policy (segment 10).
// Sails UVs, projected patterns and detail/environment overrides remain pending.
// Source-mask weights, sails, projected patterns and detail/environment overrides.
import {textureRoles} from '../src/display-settings.mjs';
import {patternDeclarations, patternComposition} from './projected-patterns.js';
import {detailDeclarations, detailComposition, detailSurface} from './detail-material.js';
import {environmentDeclarations, environmentComposition} from './environment-material.js';
import {normalDeclarations} from './material-normal.js';
import {surfacePolicyDeclarations} from './material-surface-policy.js';
import {paintMask} from './material-paint-composition.js';

export function runtimeDeclarations(sails, patterns = 0, detail = false, environment = false, roles = []) {
  return `
uniform sampler2D eve_MaterialMap, eve_PaintMaskMap, eve_RoughnessMap;
uniform sampler2D eve_DirtMap, eve_DustNoiseMap, eve_GlowMap;
uniform vec3 eve_diffuse[4], eve_fresnel[4], eve_dustColor[4], eve_glowColor;
uniform vec4 eve_gloss, eve_sails;
uniform float eve_paint, eve_dirtLevel, eve_dirtStrength;
${patternDeclarations(patterns, roles)}
${detail ? detailDeclarations : ''}
${environment ? environmentDeclarations : ''}
${textureRoles.map(role => `uniform float eve_use${role};`).join('\n')}
${sails ? 'uniform sampler2D eve_SailsDetailMap;' : ''}
${surfacePolicyDeclarations}
${normalDeclarations}
vec3 eveLayer(vec4 w, vec3 colors[4]) {
  return w.x*colors[0]+w.y*colors[1]+w.z*colors[2]+w.w*colors[3];
}
`;
}


export function layerComposition(sails, patterns, detail, environment, roles) {
  return `
vec2 eveUV=vMapUv${environment ? '*eve_GeneralTiling.y' : ''};
float eveMask=texture2D(eve_MaterialMap,${environment ? 'vMapUv*eve_GeneralTiling.x' : 'eveUV'}).r*eve_useMaterialMap;
${
  sails
    ? `float eveCos=cos(eve_sails.y), eveSin=sin(eve_sails.y);
vec2 eveDetailUV=eve_sails.x*vec2(eveUV.x*eveCos-eveUV.y*eveSin,eveUV.x*eveSin+eveUV.y*eveCos);
eveMask=mix(eveMask,texture2D(eve_SailsDetailMap,eveDetailUV).r,eveWeights(eveMask).x*eve_useSailsDetailMap);`
    : ''
}
vec4 eveW=eveWeights(eveMask);
${patterns ? patternComposition(patterns, roles) : ''}
${detail ? detailComposition : ''}
float evePaint=${paintMask(environment)};
vec3 eveAlbedo=mix(vec3(1.0),texture2D(map,eveUV).rgb,eve_useAlbedoMap);
vec3 eveBaseDiffuse=eveLayer(eveW,${patterns ? 'eveDiffuse' : 'eve_diffuse'});
vec3 eveBaseFresnel=eveLayer(eveW,${patterns ? 'eveFresnel' : 'eve_fresnel'});
${environment ? environmentComposition : ''}
${detail ? detailSurface : ''}
`;
}
