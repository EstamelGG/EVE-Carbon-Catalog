import {shellFacing} from './gate-shell-facing.js';

// A unit-depth homogeneous shell. Its two advected density fields add optical
// thickness; the base emitter is behind the shell, attenuated by transmittance.
// PBRT 4e, 11.2 (Beer transmittance); slot mapping is a viewer choice.
export const volumeFieldFunctions=`
${shellFacing}
vec3 advectedPoint(vec3 p,vec4 transform,vec4 scroll,float t) {
  return p*transform.x+transform.yzw+scroll.yzw+scroll.x*t;
}
vec4 volumeShell(vec4 field1,vec4 field2,vec4 mask,vec4 emission,vec4 base,float gain) {
  float density=0.5*(max(field1.g,0.0)+max(field2.r,0.0));
  float transmission=exp(-density);
  vec3 emitted=(1.0-transmission)*mask.rgb*emission.rgb;
  vec3 background=transmission*mask.a*base.rgb;
  float opacity=(1.0-transmission)*emission.a+transmission*mask.a*base.a;
  return vec4((emitted+background)*gain,clamp(opacity,0.0,1.0));
}`;

export function volumeFieldFragment(record){
  const mask=record.textures.LayerMaskMap?'texture(LayerMaskMap,maskUV)':'vec4(1)';
  return `
in vec3 gatePosition;in float facing;
uniform float time;
uniform highp sampler3D LayerAllMap;
${record.textures.LayerMaskMap?'uniform sampler2D LayerMaskMap;':''}
uniform vec4 Layer1Transform,Layer2Transform,Layer3Transform,Layer3Center;
uniform vec4 Layer1Scroll,Layer2Scroll,Layer3Scroll,FresnelFactors,FxColor,BaseColor;
out vec4 fragColor;
${volumeFieldFunctions}
void main(){
  vec4 a=texture(LayerAllMap,advectedPoint(gatePosition,Layer1Transform,Layer1Scroll,time));
  vec4 b=texture(LayerAllMap,advectedPoint(gatePosition,Layer2Transform,Layer2Scroll,time));
  vec2 maskUV=length(gatePosition-Layer3Center.xyz)*Layer3Transform.xy+Layer3Transform.zw+Layer3Scroll.xy*time+Layer3Scroll.zw;
  fragColor=volumeShell(a,b,${mask},FxColor,BaseColor,shellIntensity(facing,FresnelFactors));
}`;
}
