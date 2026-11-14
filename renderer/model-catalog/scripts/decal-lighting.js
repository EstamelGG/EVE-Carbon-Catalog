import {previewSpecularGain} from './native-environment-light.js';
import {environmentLighting} from './native-environment-light.js';
// SOURCE AUDIT 2026-11-11 [L01-L02/M01-M04]: Reviewed with unresolved game-specific terms/policies; see consolidated report for limited public matches.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
import {ShaderChunk} from 'three';
import {nativeLightingChunk} from './native-brdf.js';
import {reflectionDeclarations} from './native-reflections.js';
import {shDeclarations} from './native-sh.js';
import {sourceLightPars,sourceLightLoop} from './three-lighting-adapter.js';

// Projected paint shares the hull's native light rig, SH and source cube maps.
// The generic model-viewer environment is disabled by installNativePreview.
export function applyDecalLighting(shader, uniforms) {
  if (!uniforms) return;
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = `
uniform float eve_reflectionStrength, eve_ambientStrength, eve_environmentStrength;
uniform float eve_f0Strength, eve_roughnessScale;
vec3 eve_referenceNormal;
${reflectionDeclarations}
${shDeclarations}
` + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>',
    nativeLightingChunk(ShaderChunk.lights_physical_pars_fragment));
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_pars_begin>',
    sourceLightPars());
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',sourceLightLoop());
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', environmentLighting);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
eve_referenceNormal=nonPerturbedNormal;
#include <lights_physical_fragment>
material.specularColor=clamp(texture2D(decalF0,decalUV).rgb*eve_f0Strength,0.0,1.0);
material.specularColorBlended=material.specularColor;
material.specularF90=1.0;
material.diffuseContribution=diffuseColor.rgb;
material.roughness=clamp(roughnessFactor*eve_roughnessScale,0.0001,1.0);
`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
#include <lights_fragment_end>
${previewSpecularGain}
`);
}
