import {Data3DTexture,RGBAFormat,RedFormat,FloatType,HalfFloatType,UnsignedByteType,LinearFilter,LinearMipmapLinearFilter,RepeatWrapping} from 'three';
import {read} from 'three/examples/jsm/libs/ktx-parse.module.js';
import {ZSTDDecoder} from 'three/examples/jsm/libs/zstddec.module.js';

let decoder;
export async function decodeVolumeKtx2(bytes){
  const image=read(new Uint8Array(bytes));
  if(!(image.pixelDepth>1)||image.faceCount!==1||image.layerCount>1)throw Error('Invalid volume KTX2');
  const formats={37:[RGBAFormat,UnsignedByteType,Uint8Array,4],9:[RedFormat,UnsignedByteType,Uint8Array,1],
    100:[RedFormat,FloatType,Float32Array,1],109:[RGBAFormat,FloatType,Float32Array,4],76:[RedFormat,HalfFloatType,Uint16Array,1]};
  const format=formats[image.vkFormat];if(!format)throw Error('Unsupported volume KTX2 format '+image.vkFormat);
  if(![0,2].includes(image.supercompressionScheme))throw Error('Unsupported volume compression');
  if(image.supercompressionScheme===2){decoder??=new ZSTDDecoder();await decoder.init();}
  const [channels,type,ArrayType,count]=format;
  const levels=image.levels.map((level,i)=>{
    const raw=image.supercompressionScheme===2?decoder.decode(level.levelData,level.uncompressedByteLength):level.levelData;
    const width=Math.max(1,image.pixelWidth>>i),height=Math.max(1,image.pixelHeight>>i),depth=Math.max(1,image.pixelDepth>>i);
    if(raw.byteLength!==width*height*depth*count*ArrayType.BYTES_PER_ELEMENT)throw Error('Invalid volume mip length');
    return {data:new ArrayType(raw.slice().buffer),width,height,depth};
  });
  const first=levels[0],texture=new Data3DTexture(first.data,first.width,first.height,first.depth);
  texture.format=channels;texture.type=type;texture.wrapS=texture.wrapT=texture.wrapR=RepeatWrapping;
  texture.generateMipmaps=levels.length>1;texture.minFilter=texture.generateMipmaps?LinearMipmapLinearFilter:LinearFilter;texture.magFilter=LinearFilter;
  // Three's Data3DTexture uploads level zero and generates the GPU mip chain;
  // the asset retains every authored mip for consumers with explicit uploads.
  texture.userData.sourceLevels=levels;texture.needsUpdate=true;return texture;
}
