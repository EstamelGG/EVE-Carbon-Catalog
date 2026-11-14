import { AddEquation, CustomBlending, DoubleSide, GLSL3, OneFactor, ShaderMaterial, Vector4 } from 'three';
import { inverseDecalProjection, projectedDecalVertex } from './decal-projection.js';

// The first-generation web preview was measured with a white mask, a coordinate
// ramp and 18 grey/gain combinations. See docs/source-remediation-42-evidence.json.
// The row order and linear emission below describe those observations.
const fragment = `
in vec2 projected;
out vec4 fragColor;
uniform sampler2D transparencyMap;
uniform vec3 marksPerRow;
uniform vec4 textureScaling, glowColor;
uniform float intensity;

void main() {
  vec2 uv = (projected + 1.0) * 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) discard;
  vec2 ordered = mix(uv, 1.0 - uv, greaterThanEqual(textureScaling.xy, vec2(0.5)));
  ivec2 cell = ivec2(ordered * vec2(9, 3));
  if (cell.y >= 3) discard;
  if (float(cell.x) >= marksPerRow[cell.y]) discard;

  float mask = texture(transparencyMap, uv * vec2(9, 1)).r;
  fragColor = vec4(max(glowColor.rgb, vec3(0)) * mask * intensity, 0);
}`;

export function createKillMarkMaterial(record, transparencyMap, marksPerRow) {
  const p = record.parameters;
  const material = new ShaderMaterial({
    vertexShader: projectedDecalVertex,
    fragmentShader: fragment,
    glslVersion: GLSL3,
    uniforms: {
      decalProjection: {value: inverseDecalProjection(record)},
      textureScaling: {value: new Vector4(...p.DecalTextureScaling)},
      transparencyMap: {value: transparencyMap},
      glowColor: {value: new Vector4(...p.DecalGlowColor)},
      intensity: {value: p.DecalIntensityData[0]},
      marksPerRow,
    },
    transparent: true, depthWrite: false, side: DoubleSide,
    blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor, blendEquation: AddEquation,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  material.userData.eveBloomEmission = true;
  material.forceSinglePass = true;
  return material;
}
