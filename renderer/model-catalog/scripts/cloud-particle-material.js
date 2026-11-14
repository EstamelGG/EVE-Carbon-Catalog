// The SOF effect's artist annotations name UV scale/offset, source and
// destination alpha influence, and depth scale. Two color layers modulate
// per channel; the coverage mask modulates opacity independently of color.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shadercompiler/python/shadercompiler/effectinfo.py
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/packing.glsl.js
import {Vector2,Vector4,OneFactor,OneMinusSrcAlphaFactor} from 'three';

import {spriteComposite} from './particle-material.js';
import {cloudBrightness} from './cloud-brightness.js';
import metadata from './gate-parameter-defaults.json' with {type:'json'};

const cloudEffect='res:/graphics/effect.dx11/managed/space/specialfx/particles/2layermask.sm_depth';
const fields=['SpriteColor','SpriteFactors','ParticleParams','DepthFadeControl','Brightness',
  'Layer1TexCoordModifier','Layer2TexCoordModifier','Layer1TexCoordSpeed','Layer2TexCoordSpeed'];

export function cloudFragment(options={}) {
  return `#include <packing>
in vec2 gateUV;in vec4 gateTint,gateOffset;
in float effectDepth,cloudScale,cloudSize;
out vec4 fragColor;
uniform sampler2D layer1,layer2,maskMap,effectSceneDepth;
uniform vec4 SpriteColor,SpriteFactors,Layer1TexCoordModifier,Layer2TexCoordModifier,
 Layer1TexCoordSpeed,Layer2TexCoordSpeed,ParticleParams,DepthFadeControl,Brightness;
uniform float time;uniform vec2 effectDepthSize,effectCameraRange;uniform bool effectHasDepth;
${spriteComposite}
vec2 cloudUV(vec4 transform, vec4 speed, vec2 offset) {
    return gateUV * transform.xy + transform.zw + speed.xy * time + offset;
}

float softIntersection() {
    if (!effectHasDepth) return 1.0;
    vec2 screenUV = gl_FragCoord.xy / effectDepthSize;
    float depth = texture(effectSceneDepth, screenUV).r;
    float surfaceDistance = -perspectiveDepthToViewZ(depth, effectCameraRange.x, effectCameraRange.y);
    float width = cloudSize * DepthFadeControl.x;
    float gap = surfaceDistance - effectDepth;
    return width > 0.0 ? clamp(gap / width, 0.0, 1.0) : step(0.0, gap);
}

void main() {
    vec4 offsets = ${options.TEXTURE_OFFSETS === 'TEXTURE_OFFSETS_ENABLED' ? 'gateOffset' : 'vec4(0.0)'};
    vec2 first = cloudUV(Layer1TexCoordModifier, Layer1TexCoordSpeed, offsets.xy);
    vec2 second = cloudUV(Layer2TexCoordModifier, Layer2TexCoordSpeed, offsets.zw);
    vec4 surface = texture(layer1, first) * texture(layer2, second);
    float coverage = texture(maskMap, gateUV).r;
    ${options.NEAR_FADE === 'NEAR_FADE_ENABLED' ? `
    float range = ParticleParams.y - ParticleParams.x;
    float distanceFromStart = effectDepth / cloudScale - ParticleParams.x;
    coverage *= range != 0.0 ? clamp(distanceFromStart / range, 0.0, 1.0) : step(0.0, distanceFromStart);` : ''}
    vec4 pigment = surface * (gateTint * SpriteColor);
    fragColor = compositeSprite(pigment, SpriteFactors) * (coverage * softIntersection() * Brightness.x);
}`;
}

export async function cloudParticleMaterial(source,resources,vertex) {
  const defaults=metadata.effects[source.effectResource]??metadata.effects[cloudEffect];
  const vector=v=>Array.isArray(v)?v:[v,0,0,0];
  const uniforms=Object.fromEntries(fields.map(k=>[k,{value:new Vector4(...vector(source.parameters?.[k]??defaults[k]))}]));
  for(const [name,slot] of [['layer1','TexMapLayer1'],['layer2','TexMapLayer2'],['maskMap','MaskMap']])
    uniforms[name]={value:await resources.texture(source.textures[slot],{repeat:name!=='maskMap'})};
  Object.assign(uniforms,{time:{value:0},effectSceneDepth:{value:null},effectHasDepth:{value:false},
    effectDepthSize:{value:new Vector2(1,1)},effectCameraRange:{value:new Vector2(.1,100)}});
  const material=resources.additiveMaterial(vertex,cloudFragment(source.options),uniforms);
  material.defines={...material.defines,EVE_CLOUD_DEPTH:1};
  material.blendSrc=OneFactor;material.blendDst=OneMinusSrcAlphaFactor;
  function update(parameters, time) {
    uniforms.time.value = time;
    for (const key of fields) {
      if (parameters[key] !== undefined) uniforms[key].value.fromArray(vector(parameters[key]));
    }
    if (source.brightnessController?.kind === 'fractalProduct') {
      uniforms.Brightness.value.x = cloudBrightness(source.brightnessController, time);
    }
  }
  update(source.parameters??{}, 0);
  return {material, uniforms, update};
}
