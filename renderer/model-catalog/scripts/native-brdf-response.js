// Three integration for the public Filament kernels (remediation 07).
// Our preview convention converts authored light RGB to radiance with PI.
// D and Lambert now both use their explicit 1/PI normalization. This keeps
// ordinary preview brightness without asserting that the source asset's
// intensity is an SI unit or that the entire material model is public.
// Remediation 08 replaces the unsupported legacy horizon expression with
// PBRT reflection-side selection plus our smooth reference-normal adapter.
// See surface-reflection.js for the source and the deliberate behavior change.
export const directBRDF = `
 // Zero-contribution lights must not pay for the clean and dust GGX lobes.
 if (!directLight.visible) return;
 #if !defined(EVE_OPAQUE_QUAD_HULL) && !defined(EVE_SKINNED_QUAD_HULL)
 if (!eveSameReflectionSide(eve_referenceNormal,geometryViewDir,directLight.direction)) return;
 #endif
 float nl=max(dot(geometryNormal,directLight.direction),0.0);
 if (nl == 0.0) return;
 float alpha=material.roughness*material.roughness;
 vec3 h=normalize(directLight.direction+geometryViewDir);
 // Local two-sided preview convention; guard the grazing view at 1e-5.
 float nv=max(abs(dot(geometryNormal,geometryViewDir)),0.00001);
 float nh=clamp(dot(geometryNormal,h),0.0,1.0);
 float lh=clamp(dot(directLight.direction,h),0.0,1.0);
 vec3 f=eveSchlickFresnel(material.specularColor,lh);
 float d=eveGGXDistribution(alpha,nh);
 float v=eveGGXVisibility(alpha,nv,nl);
 vec3 light=(PI*directLight.color)*nl;
 reflectedLight.directSpecular+=light*f*d*v;
 reflectedLight.directDiffuse+=light*material.diffuseContribution*(1.0-f)*eveLambertDiffuse();
`;
