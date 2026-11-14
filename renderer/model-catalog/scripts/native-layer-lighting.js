import {previewSpecularGain} from './native-environment-light.js';
// General materials use area-weighted dust. Opaque quad hulls preserve the
// original first-generation viewer response (native-shader.js, clean weight):
// coverage attenuates the underlying metal in addition to replacing its area.
// MaterialX pbrlib, mx_mix_bsdf.glsl. Dust uses the glTF default dielectric
// interface (IOR 1.5, F0 0.04). The stored green lane is a half-range strength.
export function layerLighting(runtime) {
  return `#include <lights_physical_fragment>
vec3 eveF0=clamp(${runtime ? 'eveRuntimeF0' : 'texture2D(eve_f0,vMapUv).rgb'}*eve_f0Strength,0.0,1.0);
vec3 eveDust=${runtime ? 'eveRuntimeDust' : 'texture2D(eve_dust_surface,vMapUv).rgb'};
material.specularColor=eveF0;
material.specularColorBlended=eveF0;
material.specularF90=1.0;
material.diffuseContribution=diffuseColor.rgb;
// The source map stores alpha=(1-gloss)^2. Three squares its perceptual
// roughness inside BRDF_GGX, so pass sqrt(alpha) to avoid squaring twice.
material.roughness=clamp(sqrt(roughnessFactor)*eve_roughnessScale,0.0001,1.0);
#include <lights_fragment_begin>
#include <lights_fragment_maps>
#include <lights_fragment_end>
ReflectedLight eveClean=reflectedLight;
reflectedLight=ReflectedLight(vec3(0),vec3(0),vec3(0),vec3(0));
material.diffuseColor=${runtime ? 'eveRuntimeDustBase' : 'texture2D(eve_dust_base,vMapUv).rgb'};
material.diffuseContribution=material.diffuseColor;
float eveDustSpecularWeight=clamp(2.0*eveDust.g,0.0,1.0);
material.specularColor=vec3(clamp(0.04*eveDustSpecularWeight*eve_f0Strength,0.0,1.0));
material.specularColorBlended=material.specularColor;
material.roughness=clamp(sqrt(eveDust.r)*eve_roughnessScale,0.0001,1.0);
#define EVE_DUST_LAYER
{
#include <lights_fragment_begin>
#include <lights_fragment_maps>
#include <lights_fragment_end>
}
#undef EVE_DUST_LAYER
float eveDustCoverage=clamp(eveDust.b,0.0,1.0);
float eveCleanWeight=1.0-eveDustCoverage;
#ifdef EVE_OPAQUE_QUAD_HULL
eveCleanWeight=eveCleanWeight*eveCleanWeight*eveCleanWeight;
#endif
reflectedLight.directDiffuse=eveClean.directDiffuse*eveCleanWeight + reflectedLight.directDiffuse*eveDustCoverage;
reflectedLight.directSpecular=eveClean.directSpecular*eveCleanWeight + reflectedLight.directSpecular*eveDustCoverage;
reflectedLight.indirectDiffuse=eveClean.indirectDiffuse*eveCleanWeight + reflectedLight.indirectDiffuse*eveDustCoverage;
reflectedLight.indirectSpecular=eveClean.indirectSpecular*eveCleanWeight + reflectedLight.indirectSpecular*eveDustCoverage;
// Scale the complete hull specular response, including direct preview lights.
// Applying this after the dust blend preserves the source material at 1.0.
${previewSpecularGain}`;
}
