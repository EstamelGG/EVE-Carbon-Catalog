// Viewer dust layer. The 20-repeat detail map is also documented in the
// authoring metadata (LodUvScale0). The level is a base-2 coverage exposure.
// The four noise lanes vary diffuse reflectance, specular weight, roughness,
// and coverage. Their ranges are choices of this viewer's material profile.
export const dustComposition = `vec4 eveDustNoise=mix(vec4(1.0),texture2D(eve_DustNoiseMap,vMapUv*20.0),eve_useDustNoiseMap);
float eveDustRoughness=mix(1.0,1.0-eveRough,eveDustNoise.b);
float eveDustMask=texture2D(eve_DirtMap,eveUV).r*eve_useDirtMap;
// Viewer calibration for the opaque quad hull profile. On type 608 the first
// viewer covers 0.60 of the dirt mask at the default level; +0.75 exposure
// stops gives 0.595 with this viewer's existing exposure curve.
#ifdef EVE_OPAQUE_QUAD_HULL
const float eveDustExposureOffset = 0.75;
// The baseline uses the detail channels as variations around a dusty
// dielectric. A black detail texel should not remove the whole dust lobe.
eveDustNoise.rg += vec2(0.5) * eve_useDustNoiseMap;
eveDustRoughness = 1.0 - eveRough * mix(0.4, 0.2 + 0.4 * eveDustNoise.b, eve_useDustNoiseMap);
#else
const float eveDustExposureOffset = 0.0;
#endif
float eveCoverage=clamp(eveDustMask*eveDustNoise.a*exp2(clamp(eve_dirtLevel+eveDustExposureOffset,-16.0,16.0))*eve_dirtStrength,0.0,1.0);
vec3 eveRuntimeDust=vec3(eveDustRoughness*eveDustRoughness,eveDustNoise.g*0.5,eveCoverage);
vec3 eveRuntimeDustBase=clamp(eveAlbedo*eveLayer(eveW,eve_dustColor)*eveDustNoise.r,0.0,1.0);
`;
