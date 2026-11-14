// Authoring interface and ordered alpha-over preview policy are documented
// with independent framebuffer verification in docs/environment-material-verification.md.
import {Vector3, Vector4} from 'three';
export const hasEnvironment = native => /\/(?:skinned_)?quadenvironmentv5\.fx$/i.test(native.effect || '')
  && !!native.textures?.Detail1Map && !!native.textures?.Detail2Map;
export function environmentUniforms(native) {
  if (!hasEnvironment(native)) return {};
  const result={}, p=native.parameters;
  for(const name of ['GeneralTiling','DetailData','Detail1Material','Detail2Material']) {
    if(!p[name]) throw new Error(`Missing environment constant: ${name}`);
    result['eve_'+name]={value:new Vector4(...p[name])};
  }
  for(const name of ['Detail1AlbedoColor','Detail2AlbedoColor','Detail1FresnelColor','Detail2FresnelColor']) {
    if(!p[name]) throw new Error(`Missing environment constant: ${name}`);
    result['eve_'+name]={value:new Vector3(...p[name].slice(0,3))};
  }
  return result;
}
export const environmentDeclarations=`
uniform vec4 eve_GeneralTiling,eve_DetailData,eve_Detail1Material,eve_Detail2Material;
uniform vec3 eve_Detail1AlbedoColor,eve_Detail2AlbedoColor,eve_Detail1FresnelColor,eve_Detail2FresnelColor;
uniform sampler2D eve_Detail1Map,eve_Detail2Map;
`;
export const environmentComposition=`
vec4 eveED1=texture2D(eve_Detail1Map,vMapUv*eve_DetailData.x);
vec4 eveED2=texture2D(eve_Detail2Map,vMapUv*eve_DetailData.y);
float eveES1=dot(eveW,eve_Detail1Material),eveES2=dot(eveW,eve_Detail2Material);
vec3 eveEnvironmentNormal=(eveED1.rgb*2.0-1.0)*eveES1+(eveED2.rgb*2.0-1.0)*eveES2;
float eveEB1=clamp(eveES1*eveED1.a,0.0,1.0),eveEB2=clamp(eveES2*eveED2.a,0.0,1.0);
eveBaseDiffuse=mix(mix(eveBaseDiffuse,eve_Detail1AlbedoColor,eveEB1),eve_Detail2AlbedoColor,eveEB2);
eveBaseFresnel=mix(mix(eveBaseFresnel,eve_Detail1FresnelColor,eveEB1),eve_Detail2FresnelColor,eveEB2);
`;
