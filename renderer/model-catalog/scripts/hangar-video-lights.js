/*!
 * Video frame averages adapted from carbonengine/videoplayer VpxDecoder.cpp (MIT).
 * https://github.com/carbonengine/videoplayer/blob/7ccc087089d66db3861fc966361c7428b1d17c8a/VpxDecoder.cpp
 * Copyright © 2015 CCP ehf.
 * MIT License
 *
 * Copyright (c) 2026 Fenris Creations
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Preserve the decoder's integer coefficients and per-pixel clipping before averaging.
const K1=76283,K2=132251,K3=53280,K4=25624,K5=104595;
const channel=value=>Math.min(255,Math.max(0,(value+32768)>>16));

export function averageVideoPlanes(bytes,planes,width,height,format){
 const packed=format==='NV12',shift=format==='I444'?0:1;
 const [yp,up,vp]=planes;
 let r=0,g=0,b=0;
 for(let y=0;y<height;y++){
  const luma=yp.offset+y*yp.stride;
  const uBase=up.offset+(y>>shift)*up.stride;
  const vBase=packed?uBase+1:vp.offset+(y>>shift)*vp.stride;
  for(let x=0;x<width;x++){
   const uv=packed?(x>>1)*2:x>>shift;
   const u=bytes[uBase+uv]-128,v=bytes[vBase+uv]-128;
   const l=K1*(bytes[luma+x]-16);
   r+=channel(l+K2*v);g+=channel(l-K3*u-K4*v);b+=channel(l+K5*u);
  }
 }
 const scale=1/(255*width*height);
 return [r*scale,g*scale,b*scale];
}

function screenSampler(video){
 const win=video.ownerDocument.defaultView;
 let bytes,context;
 return async()=>{
  if(win.VideoFrame){
   const frame=new win.VideoFrame(video);
   try{
    if(['I420','I420A','NV12','I444'].includes(frame.format)){
     const options={rect:frame.visibleRect};
     const size=frame.allocationSize(options);
     if(bytes?.length!==size)bytes=new Uint8Array(size);
     const planes=await frame.copyTo(bytes,options);
     return averageVideoPlanes(bytes,planes,options.rect.width,options.rect.height,frame.format);
    }
   }catch(error){
    if(error.name!=='NotSupportedError')throw error;
   }finally{frame.close();}
  }
  // Browsers without readable YUV planes expose their decoded RGB through canvas.
  context??=video.ownerDocument.createElement('canvas').getContext('2d',{willReadFrequently:true});
  const width=video.videoWidth,height=video.videoHeight;
  if(context.canvas.width!==width||context.canvas.height!==height){context.canvas.width=width;context.canvas.height=height;}
  context.drawImage(video,0,0,width,height);
  const data=context.getImageData(0,0,width,height).data;
  let r=0,g=0,b=0;
  for(let i=0;i<data.length;i+=4){r+=data[i];g+=data[i+1];b+=data[i+2];}
  const scale=1/(255*width*height);
  return [r*scale,g*scale,b*scale];
 };
}

export function bindHangarVideoLights(group,bindings,scene){
 const lights=group?.children.filter(light=>light.userData.hangarVideo==='dynamic:/hangarvideos');
 if(!lights?.length)return;
 const named=bindings.filter(binding=>binding.channel==='dynamic:/hangarvideos');
 // Older room packages contain one unlabelled hologram video shared by all their screens.
 const candidates=named.length?named:bindings.every(binding=>!binding.channel)?bindings:[];
 const videos=new Set(candidates.map(binding=>binding.video));
 if(videos.size!==1)return;
 const [video]=videos,sample=screenSampler(video);
 let active=true,pending=false,again=false,callback,revision=0;
 function color(rgb){for(const light of lights)light.color.fromArray(rgb);scene.queueRender();}
 function clear(){revision++;color([0,0,0]);}
 async function update(){
  if(!active||video.readyState<2)return;
  if(pending){again=true;return;}
  const token=revision;pending=true;
  try{
   const rgb=await sample();
   if(active&&token===revision)color(rgb);
  }catch(error){
   if(error.name!=='InvalidStateError'&&error.name!=='SecurityError')throw error;
  }finally{
   pending=false;
   if(again){again=false;void update();}
  }
 }
 function next(){callback=video.requestVideoFrameCallback(()=>{if(active){void update();next();}});}
 const events=video.requestVideoFrameCallback?['loadeddata','seeked']:['loadeddata','seeked','timeupdate'];
 for(const event of events)video.addEventListener(event,update);
 video.addEventListener('emptied',clear);
 clear();
 if(video.requestVideoFrameCallback)next();
 if(video.readyState>=2)void update();
 return ()=>{
  active=false;revision++;
  if(callback!==undefined)video.cancelVideoFrameCallback(callback);
  for(const event of events)video.removeEventListener(event,update);
  video.removeEventListener('emptied',clear);
 };
}
