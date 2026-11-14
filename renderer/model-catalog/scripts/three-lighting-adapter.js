// Three r183 host shader patching, separate from legacy lighting formulas.
// Host source (MIT): https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js
import {roomLightPars,roomLightLoop} from './room-light-grid.js';
import {ShaderChunk} from 'three';
import {nativeLightingChunk} from './native-brdf.js';
import {environmentLighting} from './native-environment-light.js';
import {sourceLightDeclarations,distanceAttenuation,spotAttenuation,directLightResponse} from './native-light-response.js';

const accumulation = `#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>`;

export function applyLightingStages(shader, body) {
  if (!shader.fragmentShader.includes(accumulation))
    throw new Error('Unsupported Three shader layout');
  shader.fragmentShader = shader.fragmentShader.replace(
    accumulation,
    'eve_referenceNormal=nonPerturbedNormal;\n' + body,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_pars_begin>',
    sourceLightPars(),
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_physical_pars_fragment>',
    nativeLightingChunk(ShaderChunk.lights_physical_pars_fragment),
  );
  shader.fragmentShader = shader.fragmentShader.replaceAll(
    '#include <lights_fragment_maps>',
    environmentLighting,
  );
  shader.fragmentShader=shader.fragmentShader.replaceAll('#include <lights_fragment_begin>',sourceLightLoop());
}

// Shared by hull and decals: both use the same point/spot radius slots,
// cone profile and finite-source roughness processing.
export function sourceLightPars() {
  return roomLightPars+sourceLightDeclarations+['pointLight','spotLight'].reduce((chunk,light)=>chunk.replace(
    `getDistanceAttenuation( lightDistance, ${light}.distance, ${light}.decay )`,distanceAttenuation(light),
  ),ShaderChunk.lights_pars_begin).replace(
    'return smoothstep( coneCosine, penumbraCosine, angleCosine );',spotAttenuation,
  ).replaceAll(
    'light.direction = normalize( lVector );',
    'light.direction = length(lVector)>0.0 ? normalize(lVector) : vec3(0.0);',
  );
}

export function sourceLightLoop() {
  const pointCall =
    'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  let nativeBegin=ShaderChunk.lights_fragment_begin;
  for(const light of ['pointLight','spotLight']){
   const start=nativeBegin.indexOf(light==='pointLight'?'PointLight pointLight;':'SpotLight spotLight;');
   const call=nativeBegin.indexOf(pointCall,start);
   if(start<0||call<0)throw new Error('Unsupported Three direct light layout');
   nativeBegin=nativeBegin.slice(0,call)+directLightResponse(light)+nativeBegin.slice(call+pointCall.length);
  }
  return nativeBegin+roomLightLoop;
}
