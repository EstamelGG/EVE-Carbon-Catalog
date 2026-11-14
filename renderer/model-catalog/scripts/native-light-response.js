// Public kernels plus the application's Three.js material adapter.
// Raw light data and the two radius slots: source-light-contract.js.
import {pointAttenuationDeclarations} from './public-point-attenuation.js';
import {dynamicLightDeclarations} from './carbon-dynamic-light.js';

export const sourceLightDeclarations=pointAttenuationDeclarations+dynamicLightDeclarations;
export const distanceAttenuation=light=>`eveSourceDistanceAttenuation(lightDistance,${light}.distance,${light}.decay)`;
export const spotAttenuation='return eveSourceSpotAttenuation(coneCosine,penumbraCosine,angleCosine);';

// Carbon publishes a roughnessIncrease, not a Three.js material. Local mixing
// policy: add the increment to GGX alpha, saturate, then return to Three's
// perceptual sqrt(alpha) convention. This is not a claimed port of an absent
// Carbon BRDF consumer. No dimming is derived from this increment.
export const directLightResponse=light=>`if (directLight.visible) {
 PhysicalMaterial evePointMaterial=material;
 float increment=eveSourceRoughnessIncrease(${light}.decay,length(${light}.position-geometryPosition));
 float broadenedAlpha=min(material.roughness*material.roughness+increment,1.0);
 evePointMaterial.roughness=sqrt(broadenedAlpha);
 RE_Direct(directLight,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,evePointMaterial,reflectedLight);
}`;
