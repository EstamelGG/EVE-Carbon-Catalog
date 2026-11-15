import {Group,Mesh,InstancedBufferGeometry,InstancedBufferAttribute,Vector4} from 'three';

// Each three-row R32F strip stores an ordered path. The Web animation repeats
// its phase, interpolating only adjacent samples of the authored track.
export async function createHangarTraffic(record,resources) {
 const group=new Group(),geometry=resources.own(new InstancedBufferGeometry()),plane=resources.plane();
 geometry.index=plane.index;geometry.attributes={...plane.attributes};geometry.instanceCount=record.traffic.positions.length/4;
 geometry.setAttribute('trafficPosition',new InstancedBufferAttribute(record.traffic.positions,4));
 geometry.setAttribute('trafficData',new InstancedBufferAttribute(record.traffic.data,4));
 const [positionMap,texMap]=await Promise.all([resources.texture(record.material.textures.PositionMap,{repeat:true}),resources.texture(record.material.textures.TexMap)]);
 const uniforms={time:{value:0},PositionMap:{value:positionMap},TexMap:{value:texMap}};
 for(const [name,value] of Object.entries(record.material.parameters))uniforms[name]={value:new Vector4(...value)};
 const common=`in vec4 trafficPosition,trafficData;uniform sampler2D PositionMap;
 uniform vec4 TextureProperties,SpriteSizes,SpriteProperties,GlowColor1,GlowColor2,BoosterColor;
 uniform float time;out vec2 trafficUV;out vec3 trafficColor;
 vec3 pointAt(int x,int lane){
  return vec3(texelFetch(PositionMap,ivec2(x,lane),0).r,
              texelFetch(PositionMap,ivec2(x,lane+1),0).r,
              texelFetch(PositionMap,ivec2(x,lane+2),0).r);
 }
 void main(){
  ivec2 dims=textureSize(PositionMap,0);
  int lane=3*(int(max(0.0,trafficPosition.w)) % max(dims.y/3,1));
  int last=dims.x-1;
  float phase=fract(trafficData.w+trafficData.y*TextureProperties.z*time)*float(last);
  int sampleIndex=min(int(phase),max(last-1,0));
  vec3 start=pointAt(sampleIndex,lane),end=pointAt(min(sampleIndex+1,last),lane);
  vec3 local=mix(start,end,phase-float(sampleIndex))+trafficPosition.xyz*TextureProperties.w;
  vec4 center=modelViewMatrix*vec4(local,1.0);
  float worldScale=length(modelMatrix[0].xyz);
  float distanceLocal=max(length(center.xyz)/max(worldScale,1e-6),1.0);
  float gain=max(SpriteProperties.y,0.0)*pow(distanceLocal,clamp(SpriteProperties.x,0.0,1.0));
  vec2 axis=vec2(1.0,0.0),shape=SpriteSizes.xy;
  vec3 color=mix(GlowColor1.rgb,GlowColor2.rgb,clamp(trafficData.z,0.0,1.0));`;
 for(const booster of [false,true]) {
  const vertex=common+(booster?`
  vec3 tail=mat3(modelViewMatrix)*(start-end)*sign(trafficData.y);
  float projected=length(tail.xy);
  if(projected>1e-6)axis=tail.xy/projected;
  float rear=clamp(dot(tail,-center.xyz)/max(length(tail)*length(center.xyz),1e-6),0.0,1.0);
  shape=SpriteSizes.zw;
  color=BoosterColor.rgb*rear*rear;`:'')+`
  vec2 offset=position.xy*shape*max(trafficData.x,0.0)*gain*worldScale;
  center.xy+=axis*offset.x+vec2(-axis.y,axis.x)*offset.y;
  float fade=clamp(SpriteProperties.z/distanceLocal,0.0,1.0);
  trafficColor=color*fade;trafficUV=uv;
  gl_Position=projectionMatrix*center;}`;
  const material=resources.additiveMaterial(vertex,`in vec2 trafficUV;in vec3 trafficColor;uniform sampler2D TexMap;out vec4 fragColor;
 void main(){vec4 texel=texture(TexMap,trafficUV);fragColor=vec4(texel.rgb*texel.a*trafficColor,0);}`,uniforms);
  // Apply the authored sprite alpha mask to keep light outside its silhouette at zero.
  material.forceSinglePass=true;
  const mesh=new Mesh(geometry,material);mesh.frustumCulled=false;group.add(mesh);
 }
 return {object:group,pass:{uniforms,update(parameters,time){uniforms.time.value=time;
  for(const [k,v] of Object.entries(parameters))if(uniforms[k]?.value?.isVector4)uniforms[k].value.fromArray(v);}}};
}
