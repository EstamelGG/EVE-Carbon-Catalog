import { VideoTexture, LinearFilter, NoColorSpace } from 'three';
import { resourceURL } from '../src/resource-location.mjs';

// HTML media events drive the preview sequence: https://html.spec.whatwg.org/multipage/media.html
// GPU upload: https://github.com/mrdoob/three.js/blob/r183/src/textures/VideoTexture.js
export function createEffectVideo(record, createElement = () => document.createElement('video'), resolveURL = resourceURL) {
  const video=createElement(), playlist=(record.playlist?.length?record.playlist:[record.url]).map(resolveURL);
  video.muted=true;video.defaultMuted=true;video.playsInline=true;video.preload='auto';
  video.crossOrigin='anonymous';
  const texture=new VideoTexture(video);
  texture.colorSpace=NoColorSpace;texture.flipY=false;texture.minFilter=texture.magFilter=LinearFilter;
  // Preview convention: sample encoded video values alongside the authored masks.
  let index=0,playing=false,disposed=false,failures=0;
  const play=()=>{if(playing&&!disposed)video.play()?.catch(()=>{});};
  const load=()=>{video.src=playlist[index];video.load();play();};
  const next=()=>{index=(index+1)%playlist.length;load();};
  const ready=()=>{failures=0;play();};
  const failed=()=>{if(++failures<playlist.length)next();};
  video.addEventListener('ended',next);video.addEventListener('canplay',ready);video.addEventListener('error',failed);
  load();
  return {texture,video,setPlaying(value){
    value=Boolean(value);if(disposed||value===playing)return;playing=value;
    if(value)play();else video.pause();
  },dispose(){
    if(disposed)return;disposed=true;playing=false;video.pause();
    video.removeEventListener('ended',next);video.removeEventListener('canplay',ready);video.removeEventListener('error',failed);
    video.removeAttribute('src');video.load();texture.dispose();
  }};
}
