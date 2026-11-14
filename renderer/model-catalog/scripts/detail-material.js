// Preview detail policy. Each sampler has one (scale, intensity, offsetU, offsetV) tuple.
// See docs/detail-material-verification.md for the affine sampling and mask coverage contract.
import {Vector3, Vector4} from 'three';

// Older publications omitted detail maps. Keep their previous base rendering
// until rebuilt instead of enabling an unbound sampler in the new viewer.
export const hasDetail = native => /\/(?:skinned_)?quad(?:heat)?detailv5\.fx$/i.test(native.effect || '')
  && !!native.textures?.Detail1Map && !!native.textures?.Detail2Map
  && (/quadheatdetailv5/i.test(native.effect) || !!native.textures?.Detail3Map);

export function detailUniforms(native) {
  if (!hasDetail(native)) return {};
  const p = native.parameters, result = {};
  for (const name of ['Detail1Data','Detail2Data','Detail3Data','DetailSelector']) {
    const source = name === 'Detail3Data' && /quadheatdetailv5/i.test(native.effect) ? 'SecondaryDetail2Data' : name;
    if (!p[source]) throw new Error(`Missing detail constant: ${source}`);
    result['eve_'+name] = {value:new Vector4(...p[source])};
  }
  for (const name of ['DetailAlbedoColor','DetailFresnelColor']) {
    if (!p[name]) throw new Error(`Missing detail constant: ${name}`);
    result['eve_'+name] = {value:new Vector3(...p[name].slice(0,3))};
  }
  return result;
}

export const detailDeclarations = `
uniform sampler2D eve_Detail1Map,eve_Detail2Map,eve_Detail3Map;
uniform vec4 eve_Detail1Data,eve_Detail2Data,eve_Detail3Data,eve_DetailSelector;
uniform vec3 eve_DetailAlbedoColor,eve_DetailFresnelColor;
`;

export const detailComposition = `
vec4 eveD1=texture2D(eve_Detail1Map,eveUV*eve_Detail1Data.x+eve_Detail1Data.zw);
vec4 eveD2=texture2D(eve_Detail2Map,eveUV*eve_Detail2Data.x+eve_Detail2Data.zw);
vec4 eveD3=texture2D(eve_Detail3Map,eveUV*eve_Detail3Data.x+eve_Detail3Data.zw);
float eveDetailStrength=clamp(dot(eve_DetailSelector,eveW),0.0,1.0);
float eveDetailBlend=clamp(dot(vec3(eveD1.a,eveD2.a,eveD3.a),vec3(eve_Detail1Data.y,eve_Detail2Data.y,eve_Detail3Data.y)),0.0,1.0)*eveDetailStrength;
vec3 eveDetailOffset1=eveD1.rgb*2.0-1.0;
vec3 eveDetailOffset2=eveD2.rgb*2.0-1.0;
vec3 eveDetailOffset3=eveD3.rgb*2.0-1.0;
vec3 eveDetailNormal=(eveDetailOffset1+eveDetailOffset2+eveDetailOffset3)*eveDetailStrength;
`;

// The same opaque-layer coverage applies to base color and interface reflectance.
export const detailSurface = `
eveBaseDiffuse=mix(eveBaseDiffuse,eve_DetailAlbedoColor,eveDetailBlend);
eveBaseFresnel=mix(eveBaseFresnel,eve_DetailFresnelColor,eveDetailBlend);`;
