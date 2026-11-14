import {previewSpecularGain} from './native-environment-light.js';
// Glass coverage and straight-alpha output calibrated against first-generation WebGL readbacks.
// Measurements and scope: docs/source-remediation-82-evidence.json.
import { DoubleSide } from 'three';

export const isGlassMaterial = (native) =>
  /(?:^|\/)(?:skinned_)?quadglassv5\.fx$/i.test(native?.effect || '');

export function configureGlass(material) {
  material.transparent = true;
  material.opacity = 1;
  material.depthWrite = false;
  material.side = DoubleSide;
  material.forceSinglePass = false;
}

export const glassMaskExpression = 'clamp(texture2D(eve_PaintMaskMap,vMapUv).r,0.0,1.0)*eve_usePaintMaskMap';

export const glassComposition = `
float eveGlassMask=${glassMaskExpression};
diffuseColor.a=1.0-eveGlassMask;
diffuseColor.rgb=vec3(0.0);
vec3 eveGlassTint=eveLayer(eveW,eve_diffuse)*eveGlassMask;
eveRuntimeF0=clamp(eveLayer(eveW,eve_fresnel),0.0,1.0);
eveAlpha=eveSurfaceAlpha(dot(eveW,eve_gloss),eveRough,0.0);
`;

// The four SOF colors specify normal-incidence reflectance. Texture gloss and
// the roughness control set lobe width separately. Three r183 uses a .0525
// perceptual floor for finite GGX highlights at base environment resolution.
export const glassReflectance = `
material.specularColor=clamp(eveRuntimeF0*eve_f0Strength,0.0,1.0);
material.specularColorBlended=material.specularColor;
material.specularF90=1.0;
material.diffuseContribution=vec3(0.0);
material.roughness=clamp(sqrt(roughnessFactor)*eve_roughnessScale,0.0525,1.0);
`;

export const glassLighting = `#include <lights_physical_fragment>
${glassReflectance}
#include <lights_fragment_begin>
#include <lights_fragment_maps>
#include <lights_fragment_end>
${previewSpecularGain}
`;

export const glassOutput = `
float eveFacing=clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0);
vec3 eveLensRadiance=outgoingLight+eveGlassTint*mix(1.0,0.25,eveFacing);
// The first layer uses ordinary coverage; other layers retain highlights as coverage falls.
outgoingLight=mix(eveLensRadiance/(diffuseColor.a+0.01),eveLensRadiance,eveW.x);
#include <opaque_fragment>
`;
