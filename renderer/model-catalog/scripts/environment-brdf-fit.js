// Original implementation from the published fit's two reflectance anchors:
// Dimitar Lazarov, "Getting More Physical in Call of Duty: Black Ops II",
// SIGGRAPH 2013 course notes, pp. 15-16 (a004, a1vf, a0r).
// https://blog.selfshadow.com/publications/s2013-shading-course/lazarov/s2013_pbs_black_ops_2_notes.pdf
// Public-source corroboration: ioquake/ioq3 5082548bf503b21b764c0ea0f79d6625c38d4474,
// code/renderergl2/glsl/lightall_fp.glsl::EnvironmentBRDF cites that paper.
// Its GPL implementation is NOT copied here; this derives the affine weights
// from the paper's 0.04 and 1.0 reflectance anchors instead of inherited DXBC.
// Contract: fittedGloss and NoV in [0,1], RGB normal-incidence reflectance F0.
export const environmentBRDFDeclarations = `
vec3 eveEnvironmentBRDFFit(float fittedGloss, float NoV, vec3 F0) {
  float dielectricResponse = fittedGloss *
    (min(0.475 * fittedGloss, exp2(-9.28 * NoV)) + 0.0275) + 0.015;
  float conductorResponse = 0.75 + 0.25 * fittedGloss;
  float reflectanceSlope = (conductorResponse - dielectricResponse) / (1.0 - 0.04);
  return clamp(vec3(conductorResponse) - (vec3(1.0) - F0) * reflectanceSlope, 0.0, 1.0);
}
`;

// Application adapter: map GGX alpha to the fit's gloss with g = 1-alpha.
// This preserves the accepted preview, not a claim that the paper's original
// Blinn-Phong gloss parameter or the game's texture encoding equals GGX alpha.
// The remaining material-composition provenance is tracked separately.
export const indirectBRDF = `
 float alpha = material.roughness * material.roughness;
 float NoV = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
 vec3 reflectedFraction = eveEnvironmentBRDFFit(1.0 - alpha, NoV, material.specularColor);
 reflectedLight.indirectSpecular += radiance * reflectedFraction;
 // Local energy split: Lambert diffuse receives the complementary fraction.
 reflectedLight.indirectDiffuse += irradiance / PI * material.diffuseContribution * (1.0 - reflectedFraction);
`;
