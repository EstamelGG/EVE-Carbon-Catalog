import {volumeFieldFragment} from './gate-volume-field.js';
import {attachmentAtlasTime} from './attachment-atlas-clock.js';
// The remaining flare and distortion branches retain their historical source-audit findings.
// The directional attachment uses the independently implemented overlay shader.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
import { MeshPhysicalMaterial, Vector2, Vector3, Vector4, BackSide, DoubleSide, SrcAlphaFactor, ZeroFactor, OneFactor, OneMinusSrcAlphaFactor, NormalBlending } from 'three';
import {attachmentOverlayVertex, overlayFragment} from './overlay-shaders.js';
import {volumeSphereVertex,volumeSphereFragment,hazeSphereFragment} from './volume-sphere-material.js';
import { displayDecode } from './lighting-shaders.js';
import {motionVectorVertex,motionVectorFragment} from './motion-vector-material.js';
import { glassAttachmentMaterial } from './glass-attachment-material.js';
import {twoColorFlareVertex,twoColorFlareFragment} from './two-color-flare.js';
import {gateLayerFragment, gateLayerOptions, layeredTexture} from './layered-mesh-material.js';
import parameterMetadata from './gate-parameter-defaults.json' with {type:'json'};
import {fourLayerInputs, fourLayerCoordinates, fourLayerFragment} from './four-layer-material.js';

const isLayeredGate = shader => shader === 'ubershader.fx' || shader === 'ubershadertwosided.fx' || shader === 'ubershaderquad.fx';

const legacyDefaults={DiffuseColor:[1,1,1,1],FresnelFactors:[1,1,0,0],MaskTransform:[0,0,1,1],MaskScroll:[0,0,0,0],
  TextureTransform1:[0,0,1,1],TextureTransform2:[0,0,1,1],TextureTransform3:[0,0,1,1],
  TextureScroll1:[0,0,0,0],TextureScroll2:[0,0,0,0],TextureScroll3:[0,0,0,0],
  Brightness:[1,0,0,0],Color1:[1,1,1,1],Color2:[1,1,1,1],Color3:[0,0,0,0],
  ColorMidpoint:[.5,0,0,0],SpriteColor:[1,1,1,1],Layer1TexCoordModifier:[1,1,0,0],Layer2TexCoordModifier:[1,1,0,0],
  Layer1TexCoordSpeed:[0,0,0,0],Layer2TexCoordSpeed:[0,0,0,0],Colors:[1,1,1,1],AtlasInfo:[1,1,1,1],CurrentTime:[0,0,0,0],
  Layer1Transform:[1,0,0,0],Layer2Transform:[1,0,0,0],Layer3Transform:[1,0,0,0],
  Layer1Scroll:[0,0,0,0],Layer2Scroll:[0,0,0,0],Layer3Scroll:[0,0,0,0],Layer3Center:[0,0,0,0],FxColor:[1,1,1,1],BaseColor:[0,0,0,0],
  DistortionFactors:[0,0,0,1],Colors2:[1,1,1,1],HazeControl:[1,1,1,0],HazeColor:[0,0,0,0]};
// Older packs retain only the effect basename. Use a declared default there when
// every resource with that basename that declares the parameter agrees on it.
const defaultsByName = new Map();
for (const [resource, defaults] of Object.entries(parameterMetadata.effects)) {
  const name = resource.split('/').at(-1).replace('.sm_depth', '.fx');
  if (!defaultsByName.has(name)) defaultsByName.set(name, new Map());
  const fields = defaultsByName.get(name);
  for (const [key,value] of Object.entries(defaults)) {
    if (!fields.has(key)) fields.set(key,value);
    else if (JSON.stringify(fields.get(key)) !== JSON.stringify(value)) fields.set(key,undefined);
  }
}
const legacyByName = new Map(Array.from(defaultsByName, ([name,fields]) =>
  [name,Object.fromEntries(Array.from(fields).filter(([,value])=>value!==undefined))]));

export function declaredGateParameters(record) {
  return parameterMetadata.effects[record?.effectResource] ?? legacyByName.get(record?.shader);
}

function gateParameters(record) {
  return {...legacyDefaults,...declaredGateParameters(record),...record.parameters};
}
function meshVertex(inputs = '', coordinates = '') {
  return `${inputs}
out vec2 gateUV;out vec3 gatePosition;out float facing;
out vec3 gateEye,gateNormal;
void main(){vec3 vertexPosition=position,vertexNormal=normal;
 #ifdef USE_INSTANCING
 vertexPosition=(instanceMatrix*vec4(position,1)).xyz;
 mat3 basis=mat3(instanceMatrix);
 if(abs(determinant(basis))>1e-12)vertexNormal=transpose(inverse(basis))*normal;
 #endif
 vec4 p=modelViewMatrix*vec4(vertexPosition,1);gateUV=uv;gatePosition=position;
 gateEye=normalize(-p.xyz);gateNormal=normalize(normalMatrix*vertexNormal);
 facing=dot(gateEye,gateNormal);
 ${coordinates}
 gl_Position=projectionMatrix*p;}`;
}
export const gateVertex=meshVertex();
const fourLayerVertex=meshVertex(fourLayerInputs, fourLayerCoordinates);

export function gateFragment(record) {
  if (isLayeredGate(record.shader)) return gateLayerFragment(record);
  if(record.shader==='twocolorflare.fx')return twoColorFlareFragment;
  if(record.shader==='ubershader4layer.fx')return fourLayerFragment(record);
  const textures=record.textures||{},shader=record.shader;
  const params=gateParameters(record);
  const declarations=Object.keys(params).map(k=>`uniform vec4 ${k};`).join('\n');
  const maps=Object.entries(textures).map(([k,v])=>`uniform ${v.volume?'highp sampler3D':'sampler2D'} ${k};`).join('\n');
  const sample=(name,uv='gateUV')=>name in textures?`texture(${name},${uv})`:'vec4(1)';
  if(shader==='fx3dv5.fx'&&textures.LayerAllMap)return volumeFieldFragment(record);
  let body;
  if(shader==='texturecolor.fx'){
    const uv='gateUV*'+('TextureScaling' in params?'TextureScaling.xy':'vec2(1.0)')+
      ('TextureTranslation' in params?'+TextureTranslation.xy':'');
    body=`fragColor=${sample('DiffuseMap',uv)}*DiffuseColor*Brightness.x;`;
  } else if(shader==='flare.fx') {
    // Interpret the horizontal flare LUT as a disc profile; the repeated rows
    // are padding. Radius one is the edge of the inscribed circle.
    body=`float r=min(1.0,length(gateUV*2.0-1.0));fragColor=${sample('GradientMap','vec2(r,0.5)')}*DiffuseColor*Brightness.x;`;
  } else {
    body=`vec4 c=${sample(textures.TexMap?'TexMap':'TexMapLayer1','gateUV*Layer1TexCoordModifier.xy+Layer1TexCoordModifier.zw+Layer1TexCoordSpeed.xy*time')};
      c*=${sample('TexMapLayer2','gateUV*Layer2TexCoordModifier.xy+Layer2TexCoordModifier.zw+Layer2TexCoordSpeed.xy*time')};
      float coverage=${sample('MaskMap')}.r;vec4 pigment=c*SpriteColor;
      fragColor=vec4(pigment.rgb*pigment.a,pigment.a)*(coverage*Brightness.x);`;
  }
  return `in vec2 gateUV;in vec3 gatePosition;in float facing;out vec4 fragColor;
uniform float time;${declarations}\n${maps}\n${displayDecode}
void main(){${body}}`;
}

export async function gateMaterial(record,resources,context) {
  if(['quadglassv5.fx','quadv5.fx','quaddetailv5.fx'].includes(record.shader))return glassAttachmentMaterial(record,resources,context);
  const uniforms={time:{value:0}};
  for(const [k,v] of Object.entries(gateParameters(record)))
    uniforms[k]={value:new Vector4(...(Array.isArray(v)?v:[v,0,0,0]))};
  await Promise.all(Object.entries(record.textures||{}).map(async ([k,v])=>{
    const clampMask = (isLayeredGate(record.shader) && k === 'MaskMap' && gateLayerOptions(record).MASK_TEXTURE_SAMPLING === 'CLAMP')
      || (record.shader==='ubershader4layer.fx' && /^MaskMap[12]$/.test(k));
    const motion = ['motionvectorramp.fx','motionvector.fx'].includes(record.shader);
    // Motion atlases use clamp; the mesh ramp additionally has named wrap
    // samplers for its optional diffuse layers and mask.
    const motionWrap = record.shader==='motionvectorramp.fx' && /^(MaskMap|DiffuseMap[123])$/.test(k);
    const repeat = !clampMask && !(record.shader==='flare.fx' && k==='GradientMap') && (!motion || motionWrap);
    const source = isLayeredGate(record.shader) || record.shader==='ubershader4layer.fx' ? layeredTexture(v,k,context?.colorAtlases) : v;
    uniforms[k] = {value: await resources.texture(source, {repeat})};
  }));
  let material;
  if(record.shader==='fxdirectionalv5.fx') {
    uniforms.sourceRadius={value:record.sourceRadius};uniforms.directionalScale={value:new Vector3(1,1,1)};
    material=resources.additiveMaterial(attachmentOverlayVertex,overlayFragment,uniforms);
    if(record.blend==='transparentAreas')material.blending=NormalBlending;
  } else if(['motionvectorramp.fx','motionvector.fx','volumesphere.fx','hazespherical.fx','twocolorflare.fx'].includes(record.shader)) {
    uniforms.Depth||={value:new Vector4()};
    if(record.shader==='motionvectorramp.fx')uniforms.motionLayerTime=uniforms.time;
    Object.assign(uniforms,{effectSceneDepth:{value:null},effectHasDepth:{value:false},
      effectDepthSize:{value:new Vector2(1,1)},effectCameraRange:{value:new Vector2(.1,100)}});
    const haze=record.shader==='hazespherical.fx',volume=haze||record.shader==='volumesphere.fx';
    const flare=record.shader==='twocolorflare.fx';
    material=resources.additiveMaterial(flare?twoColorFlareVertex:volume?volumeSphereVertex:motionVectorVertex,flare?twoColorFlareFragment:haze?hazeSphereFragment:volume?volumeSphereFragment:motionVectorFragment(record),uniforms);
    if(volume) {
      // The haze mesh is a local ray-exit proxy. The original uses additive
      // batches and disables depth testing; volumesphere only overrides culling.
      material.side=BackSide;
      material.depthTest=!haze;
    }
    if(!flare) {
      const premultiplied=record.effectResource?.endsWith('/particles/dynamic/motionvector.sm_depth');
      const additive=haze || record.blend==='additiveAreas' || record.blend==='distortionAreas';
      if(!additive || premultiplied) {
        material.blendSrc=premultiplied ? OneFactor : SrcAlphaFactor;
        material.blendDst=OneMinusSrcAlphaFactor;
      }
      if(additive) {
        material.blendSrcAlpha=ZeroFactor;
        material.blendDstAlpha=OneFactor;
      }
    }
  } else if(record.blend==='distortionAreas') {
    // Reuse Three's opaque-scene transmission buffer. The authored normal
    // offset is in screen pixels, rather than an invented glass thickness.
    material=resources.own(new MeshPhysicalMaterial({transmission:1,roughness:0,metalness:0,
      transparent:true,depthWrite:false,side:DoubleSide,specularIntensity:0}));
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader='varying vec2 gateUV;varying vec4 gateClip;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n gateClip=gl_Position;');
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n gateUV=uv;');
      shader.fragmentShader=`varying vec2 gateUV;varying vec4 gateClip;uniform sampler2D NormalMap1;
        uniform vec4 DistortionFactors,TextureTransform1,TextureScroll1,TextureTransform2,TextureScroll2;uniform float time;
        ${record.textures.MaskMap?'uniform sampler2D MaskMap;':''}\n`+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',`
        vec2 sourceUV=gateUV*TextureTransform1.zw+TextureTransform1.xy+TextureScroll1.xy*time+TextureScroll1.zw;
        float mask=${record.textures.MaskMap?'texture2D(MaskMap,gateUV*TextureTransform2.zw+TextureTransform2.xy+TextureScroll2.xy*time+TextureScroll2.zw).r':'1.0'};
        vec2 offset=(texture2D(NormalMap1,sourceUV).rg*2.0-1.0)*DistortionFactors.x*mask;
        vec2 screenUV=gateClip.xy/gateClip.w*0.5+0.5;
        vec4 transmitted=texture2D(transmissionSamplerMap,clamp(screenUV+offset/transmissionSamplerSize,vec2(0),vec2(1)));
        totalDiffuse=transmitted.rgb;totalSpecular=vec3(0);material.transmissionAlpha=transmitted.a;
        diffuseColor.a*=mask*clamp(abs(DistortionFactors.x),0.0,1.0);`);
    };
    material.customProgramCacheKey=()=> 'eve-gate-distortion-v1-'+Boolean(record.textures.MaskMap);
  } else {
    const vertex=record.shader==='ubershader4layer.fx'?fourLayerVertex:gateVertex;
    material=resources.additiveMaterial(vertex,gateFragment(record),uniforms);
    if(record.blend==='opaqueAreas'){
      material.transparent=false;
      material.blending=NormalBlending;
      material.depthWrite=true;
    }
    if(record.blend==='additiveAreas') {
      // RM_ALPHA_ADDITIVE writes RGB only. Preserve the intermediate target's
      // alpha independently of what the source fragment and colour wrapper emit.
      material.blendSrcAlpha=ZeroFactor;
      material.blendDstAlpha=OneFactor;
    }
    if(record.blend==='transparentAreas'){
      material.blendSrc=OneFactor;material.blendDst=OneMinusSrcAlphaFactor;
    }
  }
  // Additive faces commute; a separate back/front draw cannot change the
  // result. Avoid doubling submissions for every two-sided projector mesh.
  if(record.blend==='additiveAreas')material.forceSinglePass=true;
  material.name=record.shader;
  let previousParameters;
  return {material,uniforms,update(parameters,time){
    uniforms.time.value=time;
    if(parameters!==previousParameters){
      for(const [k,v] of Object.entries(parameters))if(uniforms[k]?.value?.isVector4)
        uniforms[k].value.fromArray(Array.isArray(v)?v:[v,0,0,0]);
      previousParameters=parameters;
    }
    if(record.shader==='motionvector.fx' && (record.options?.TIME_SOURCE==='TIME_SOURCE_TIME' ||
        (record.effectResource?.endsWith('/specialfx/motionvector.sm_depth') && !record.options?.TIME_SOURCE)))
      uniforms.CurrentTime.value.x=time;
    const atlasTime=attachmentAtlasTime(record,time,context?.advanceStaticAtlases);
    if(atlasTime!==null)uniforms.CurrentTime.value.x=atlasTime;
  }};
}
