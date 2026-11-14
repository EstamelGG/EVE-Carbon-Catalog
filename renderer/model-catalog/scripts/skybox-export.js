import {WebGLRenderer, WebGLRenderTarget, FloatType, RGBAFormat, Scene, Mesh,
 PlaneGeometry, ShaderMaterial, OrthographicCamera, Matrix3} from 'three';

import {fileCubeRotation} from './skybox-orientation.js';
import {starOverlayGLSL} from './skybox-stars.js';

// Radiance RGBE stores linear HDR values, without exposure or tone mapping.
export function encodeRadiance(pixels,width,height) {
 if(pixels.length!==width*height*4)throw Error('Invalid HDR pixel dimensions');
 const header=new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
 const rle=width>=8&&width<32768;
 const bytes=new Uint8Array(header.length+height*(width*4+(rle?4+4*Math.ceil(width/128):0)));bytes.set(header);
 let out=header.length;
 for(let y=height-1;y>=0;y--){
  const row=new Uint8Array(width*4);
  for(let x=0;x<width;x++){
   const i=(y*width+x)*4,r=x*4;
   const rgb=[0,1,2].map(c=>Number.isFinite(pixels[i+c])?Math.max(0,pixels[i+c]):0);
   const peak=Math.max(...rgb);if(peak<1e-32)continue;
   const exponent=Math.min(127,Math.floor(Math.log2(peak))+1),scale=256/2**exponent;
   for(let c=0;c<3;c++)row[r+c]=Math.min(255,Math.floor(rgb[c]*scale));
   row[r+3]=exponent+128;
  }
  if(!rle){bytes.set(row,out);out+=row.length;continue;}
  bytes.set([2,2,width>>8,width&255],out);out+=4;
  for(let c=0;c<4;c++)for(let start=0;start<width;start+=128){
   const length=Math.min(128,width-start);bytes[out++]=length;
   for(let x=start;x<start+length;x++)bytes[out++]=row[x*4+c];
  }
 }
 return bytes;
}

// The panorama direction below inverts Three.js equirectUv (longitude = atan(z, x)).
// https://github.com/mrdoob/three.js/blob/1939c35f2d92a4c870568da011aab54dabdfdd30/src/renderers/shaders/ShaderChunk/common.glsl.js#L82-L91
export function exportSkybox({entry,texture,stars}) {
 const face=texture.image?.[0],size=face?.width||face?.mipmaps?.[0]?.width||512;
 const width=Math.min(4096,Math.max(512,size*4)),height=width/2;
 const renderer=new WebGLRenderer({antialias:false});
 const target=new WebGLRenderTarget(width,height,{type:FloatType,format:RGBAFormat,depthBuffer:false});
 const geometry=new PlaneGeometry(2,2);
 const material=new ShaderMaterial({toneMapped:false,depthTest:false,depthWrite:false,uniforms:{
  skyMap:{value:texture},starMap:{value:stars},hasStars:{value:!!stars},
  rotation:{value:fileCubeRotation(new Matrix3(),entry.rotation)},
 },vertexShader:'varying vec2 uvSky;void main(){uvSky=uv;gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:`precision highp float; varying vec2 uvSky;
 uniform samplerCube skyMap;uniform sampler2D starMap;uniform bool hasStars;uniform mat3 rotation;
 ${starOverlayGLSL}
 void main(){
 float phi=(uvSky.x-.5)*6.28318530718,theta=(1.-uvSky.y)*3.14159265359;
 // Inverse of Three equirectUv: longitude = atan(z, x).
 vec3 d=vec3(sin(theta)*cos(phi),cos(theta),sin(theta)*sin(phi));
 d=rotation*vec3(-d.x,d.yz);
 vec3 color=textureCube(skyMap,d).rgb;
 if(hasStars) color+=sampleStarOverlay(starMap,d);
 gl_FragColor=vec4(color,1.);
 }`});
 try{
  if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('HDR export requires floating point render targets');
  const scene=new Scene();scene.add(new Mesh(geometry,material));renderer.setRenderTarget(target);
  renderer.render(scene,new OrthographicCamera(-1,1,1,-1,0,1));
  const pixels=new Float32Array(width*height*4);
  renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
  return {blob:new Blob([encodeRadiance(pixels,width,height)],{type:'image/vnd.radiance'}),
   name:(entry.label||entry.id||'skybox').replace(/[^a-zA-Z0-9_-]/g,'_')+'.hdr'};
 }finally{target.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();}
}
