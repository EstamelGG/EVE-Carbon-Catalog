// Flipbook time, tiles, cycle and distortion strength follow the CCP artist controls.
// SideFX Labs provides the two-frame reference: https://github.com/sideeffects/SideFXLabs/blob/41e50f90857002911f257585353247aa6c6e20ad/unity/shaders/MotionVector.shader#L93-L163
// Flow direction was measured on EVE density/flow pairs uploaded with flipY=false.
// Positive Depth.x is the local width of the Web soft intersection.
import {displayDecode} from './lighting-shaders.js';
import {shellFacing} from './gate-shell-facing.js';

export const motionVectorVertex = `out vec2 gateUV;out vec3 effectEye,effectNormal;
out float effectDepth,softDistance;uniform vec4 Depth;
void main(){vec4 p=modelViewMatrix*vec4(position,1);gateUV=uv;
 effectEye=normalize(-p.xyz);effectNormal=normalize(normalMatrix*normal);
 effectDepth=-p.z;softDistance=max(0.0,Depth.x)*length(modelMatrix[0].xyz);
 gl_Position=projectionMatrix*p;}`;

export function motionVectorFragment(record) {
  const particle=record.shader==='motionvector.fx';
  const interpolate=particle||(record.options?.INTERPOLATION??'INTERPOLATION_ENABLED')==='INTERPOLATION_ENABLED';
  const dualRamp=particle&&record.options?.COLOR_RAMP==='COLOR_RAMP_2_RAMPS';
  const ramp=particle ? dualRamp||record.options?.COLOR_RAMP==='COLOR_RAMP_ENABLED'
    : record.options?.COLORMAP!=='COLORMAP_TEXTURE';
  const layerCount=particle?0:({ONE:1,TWO:2,THREE:3}[record.options?.DIFFUSE_MAP_COUNT]??0);
  const layers=Array.from({length:layerCount},(_,i)=>i+1).filter(i=>record.textures?.['DiffuseMap'+i]);
  const mask=!particle && record.options?.MASK==='MASK_ENABLED' && record.textures?.MaskMap;
  const additive=record.blend==='additiveAreas'||record.blend==='distortionAreas';
  const transform=!particle && record.options?.TEXTURE_TRANSFORM==='TRANSFORM_ENABLED';
  return `in vec2 gateUV;in vec3 effectEye,effectNormal;in float effectDepth,softDistance;
out vec4 fragColor;uniform sampler2D TextureMap,ColorRampMap,GradientMap,effectSceneDepth;
uniform vec4 AtlasInfo,Colors,Colors2,FresnelFactors,CurrentTime;
${layers.length || transform?'uniform float motionLayerTime;':''}
${layers.map(i=>`uniform sampler2D DiffuseMap${i};uniform vec4 TextureTransform${i},TextureScroll${i};`).join('\n')}
${transform?'uniform vec4 TextureTransform,TextureScroll;':''}
${mask?'uniform sampler2D MaskMap;':''}
${dualRamp?'uniform sampler2D SelfIlluminationGradientMap;uniform vec4 SelfIllumination;':''}
uniform vec2 effectDepthSize,effectCameraRange;uniform bool effectHasDepth;
${displayDecode}
${particle?'':shellFacing}
#include <packing>

float temperatureCoordinate(float temperature, vec2 limits) {
    float span=limits.y-limits.x;
    return span==0.0?step(limits.x,temperature):clamp((temperature-limits.x)/span,0.0,1.0);
}

vec2 frameUV(sampler2D atlas, vec2 local, vec2 grid, float frame) {
    vec2 cell = vec2(mod(frame, grid.x), floor(frame / grid.x));
    vec2 pixels = vec2(textureSize(atlas, 0));
    vec2 start = cell * pixels / grid;
    vec2 end = (cell + 1.0) * pixels / grid;
    // GL linear filtering straddles texel centers. Confine the level-zero
    // footprint to this frame, including atlases not divisible by the tile count.
    vec2 firstCenter = ceil(start - 0.5) + 0.5;
    vec2 lastCenter = max(firstCenter, ceil(end - 0.5) - 0.5);
    return clamp(mix(start, end, local), firstCenter, lastCenter) / pixels;
}

vec4 frameDensity(vec2 grid, float frame, float motionFraction) {
    vec2 local = ${transform?'gateUV*TextureTransform.zw+TextureTransform.xy+TextureScroll.xy*motionLayerTime+TextureScroll.zw':'gateUV'};
    ${interpolate ? `if (motionFraction != 0.0 && Colors.w != 0.0) {
        vec2 encoded = texture(GradientMap, frameUV(GradientMap, local, grid, frame)).rg;
        local += (2.0 * encoded - 1.0) * (motionFraction * Colors.w);
    }` : ''}
    return texture(TextureMap, frameUV(TextureMap, local, grid, frame));
}

void main() {
    vec2 grid = max(vec2(1.0), floor(AtlasInfo.xy));
    float count = grid.x * grid.y;
    bool cycle = AtlasInfo.w > 0.0;
    float elapsed = AtlasInfo.z > 0.0 ? CurrentTime.x / AtlasInfo.z : 0.0;
    float cursor = cycle ? fract(elapsed) * count : clamp(elapsed * count, 0.0, count - 1.0);
    float current = floor(cursor);
    ${interpolate ? `float next = cycle ? mod(current + 1.0, count) : min(current + 1.0, count - 1.0);
    float weight = next == current ? 0.0 : fract(cursor);
    vec4 density = frameDensity(grid, current, -weight);
    if (weight > 0.0)
        density = mix(density, frameDensity(grid, next, 1.0 - weight), weight);`
    : 'vec4 density = frameDensity(grid, current, 0.0);'}
 float rampAt=temperatureCoordinate(density.r,Colors.xy);
 vec4 ramp=${ramp?'texture(ColorRampMap,vec2(rampAt,0))':'vec4(density.rgb,1.0)'};
 float gain=${particle?'Colors2.a':'shellIntensity(dot(normalize(effectEye),normalize(effectNormal)),FresnelFactors)'};
 float alpha=density.a*ramp.a;
 if(effectHasDepth&&softDistance>0.0){
   float z=texture(effectSceneDepth,gl_FragCoord.xy/effectDepthSize).r;
   float sceneDepth = -perspectiveDepthToViewZ(z, effectCameraRange.x, effectCameraRange.y);
   alpha*=clamp((sceneDepth-effectDepth)/softDistance,0.0,1.0);
 }
 vec3 color=sourceDisplayToLinear(max(ramp.rgb,vec3(0)))*Colors.z;
 ${dualRamp?`float emissionAt=temperatureCoordinate(density.r,SelfIllumination.xy);
 color+=sourceDisplayToLinear(texture(SelfIlluminationGradientMap,vec2(emissionAt,0)).rgb)*SelfIllumination.z;`:''}
 ${layers.map(i=>`vec4 detail${i}=texture(DiffuseMap${i},gateUV*TextureTransform${i}.zw+TextureTransform${i}.xy+TextureScroll${i}.xy*motionLayerTime+TextureScroll${i}.zw);
 color*=detail${i}.rgb;alpha*=detail${i}.a;`).join('\n')}
 ${mask?`float coverage=texture(MaskMap,gateUV).r;alpha*=coverage;${additive?'color*=coverage;':''}`:''}
 fragColor=vec4(color,clamp(alpha*gain,0.0,1.0));
}`;
}
