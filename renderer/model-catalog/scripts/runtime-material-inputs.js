// SOURCE AUDIT 2026-11-11 [L01-L02/M01-M04]: Reviewed with unresolved game-specific terms/policies; see consolidated report for limited public matches.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
// SOURCE REVIEW PENDING: inherited first-generation formulas, preserved verbatim.
import {Vector3, Vector4} from 'three';
import {textureRoles} from '../src/display-settings.mjs';
import {patternUniforms} from './projected-patterns.js';
import {detailUniforms} from './detail-material.js';
import {environmentUniforms} from './environment-material.js';

export function runtimeUniforms(native, loaded, dirtLevel) {
  const p = native.parameters;
  const uniforms = {};
  for (const role of textureRoles) uniforms['eve_use' + role] = {value: 1};
  for (const [role, texture] of Object.entries(loaded))
    uniforms['eve_' + role] = { value: texture };
  if (/quadheatdetailv5/i.test(native.effect || '')) uniforms.eve_Detail3Map = {value:loaded.Detail2Map};
  for (const [name, suffix, fallback] of [
    ['diffuse', 'DiffuseColor'],
    ['fresnel', 'FresnelColor'],
    ['dustColor', 'DustDiffuseColor', [1, 1, 1]],
  ])
    uniforms['eve_' + name] = {
      value: Float32Array.from([1,2,3,4].flatMap(i=>{
        const color=p[`Mtl${i}${suffix}`] || fallback;
        return [color[0]??0,color[1]??0,color[2]??0];
      })),
    };
  uniforms.eve_gloss = { value: new Vector4(...[1, 2, 3, 4].map((i) => p[`Mtl${i}Gloss`][0])) };
  uniforms.eve_paint = { value: p.GeneralData?.[0] || 0 };
  uniforms.eve_glowColor = {
    value: new Vector3(...(p.GeneralGlowColor || p.GeneralHeatGlowColor || [0, 0, 0]).slice(0, 3)),
  };
  uniforms.eve_dirtLevel = { value: dirtLevel };
  uniforms.eve_dirtStrength = { value: 1 };
  uniforms.eve_sails = { value: new Vector4(...(p.SailsDetailData || [0, 0, 0, 0])) };
  return Object.assign(uniforms, patternUniforms(native), detailUniforms(native), environmentUniforms(native));
}

