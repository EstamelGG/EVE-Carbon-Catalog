// Resource-loading adapter. Public mip math and the independently implemented
// preview response are separate from texture IO; see remediation segment 06.
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { resourceURL } from '../src/resource-location.mjs';
import { loadJSON, trackResource, readResourceBody } from '../src/resource-activity.mjs';
import {parseNativeHDR} from './hdr-cube.js';
import { CompressedCubeTexture, LinearFilter, SRGBColorSpace, LinearSRGBColorSpace, Vector3, Matrix3, Matrix4, Quaternion } from 'three';

export {roughnessMip} from './carbon-environment-map.js';
export {reflectionDeclarations} from './preview-reflection-shader.js';

// Share pending reflection loads between prefetch and material installation.
export function sessionReflections(session, race) {
  const cache = session.reflections;
  if (!cache.has(race)) cache.set(race,
    loadReflections(session.resources, race, session.json).catch(error => { cache.delete(race); throw error; }));
  return cache.get(race);
}
export async function loadReflections(resources, race, json = url => loadJSON(resourceURL(url))) {
  // reflection-preview v3 is emitted by reflection_assets.py without a client
  // worker: raw BLACK fields + official EveSpaceScene constructor defaults.
  // v2/v3 share rendering fields; v3 only adds construction provenance. This
  // does not establish the provenance of upstream material/roughness composition.
  const settings=await json('data/reflection-preview.json'), source=settings.races[race] || settings.races.gallente;
  return loadReflectionSource(resources, settings, source);
}

function reflectionCube(bytes) {
  const h=new DataView(bytes), word=i=>h.getUint32(i,true);
  if(word(84)===113)return parseNativeHDR(bytes);
  const dxgi=word(84)===0x30315844?word(128):null;
  if(dxgi===77 || dxgi===78){
    // DX10 BC3 has the same blocks as legacy DXT5 after its extra 20-byte header.
    const legacy=new Uint8Array(bytes.byteLength-20);
    legacy.set(new Uint8Array(bytes,0,128));legacy.set(new Uint8Array(bytes,148),128);
    new DataView(legacy.buffer).setUint32(84,0x35545844,true);
    bytes=legacy.buffer;
  }else if(word(84)===0 && word(88)===32 && word(92)===255 && word(100)===0xff0000){
    // DDSLoader accepts BGRA byte order for uncompressed RGBA cubes.
    const pixels=new Uint8Array(bytes);
    for(let i=128;i<pixels.length;i+=4){const r=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=r;}
    h.setUint32(92,0xff0000,true);h.setUint32(100,255,true);
  }
  const d=new DDSLoader().parse(bytes,true);
  if(!d.isCubemap||!d.mipmapCount||d.mipmaps.length!==6*d.mipmapCount)throw Error('Invalid reflection DDS cube');
  const faces=Array.from({length:6},(_,i)=>({width:d.width,height:d.height,format:d.format,
    mipmaps:d.mipmaps.slice(i*d.mipmapCount,(i+1)*d.mipmapCount)}));
  const texture=new CompressedCubeTexture(faces,d.format);
  texture.colorSpace=dxgi===95||dxgi===96?LinearSRGBColorSpace:SRGBColorSpace;
  if(d.mipmapCount===1)texture.minFilter=LinearFilter;
  texture.needsUpdate=true;
  return texture;
}

export async function loadReflectionSource(resources, settings, source) {
  const load=async url=>{
    url=(resources.resolveURL || resourceURL)(url);
    const sourceURL=resources.binaryURL?.(url)||url;
    return trackResource(url, async progress => {
      const response=await fetch(sourceURL);
      if(!response.ok)throw Error('Missing reflection cube: '+url);
      return resources.own(reflectionCube(await readResourceBody(response,progress)));
    }, 'resourceTexture');
  };
  const [reflection,diffuse]=await Promise.all([load(source.reflection),load(source.diffuse)]);
  return {settings,source,uniforms:{
    eve_environmentStrength:{value:source.intensity},
    eve_reflectionCube:{value:reflection},eve_diffuseCube:{value:diffuse},
    eve_reflectionMips:{value:reflection.image[0].mipmaps.length},
    eve_diffuseFromReflection:{value:Number.isFinite(source.defaultDiffuseRoughness)},
    eve_diffuseRoughness:{value:source.defaultDiffuseRoughness??1},
    eve_backlight:{value:new Vector3(...source.backlight)},eve_backlightContrast:{value:source.contrast},
    eve_cubeRotation:{value:new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(new Quaternion(...source.rotation).normalize().invert()))},
  }};
}
