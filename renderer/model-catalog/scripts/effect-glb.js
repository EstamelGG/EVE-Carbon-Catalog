import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {sharedGlb} from './shared-hull.js';

const quad={indices:[0,1,2,0,2,3],position:[-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0],
  uv:[0,0,1,0,1,1,0,1],normal:[0,0,1,0,0,1,0,0,1,0,0,1]};

export async function effectGeometry(session,ref){
  if(ref.primitive==='unitQuad')return quad;
  const url=new URL(session.resolveURL(ref.url),location.href).href;
  const accessor=await session.buffer('effect-accessors '+url,async()=>{
    const shared=await sharedGlb(session,url),doc=JSON.parse(shared.json),views=new Map();
    await MeshoptDecoder.ready;
    function read(id){
      const a=doc.accessors[id],ext=doc.bufferViews[a.bufferView].extensions.EXT_meshopt_compression;
      if(!views.has(a.bufferView)){
        const raw=new Uint8Array(ext.count*ext.byteStride);
        MeshoptDecoder.decodeGltfBuffer(raw,ext.count,ext.byteStride,
          new Uint8Array(shared.buffer,ext.byteOffset||0,ext.byteLength),ext.mode,ext.filter);
        views.set(a.bufferView,raw.buffer);
      }
      const Type=({5123:Uint16Array,5125:Uint32Array,5126:Float32Array})[a.componentType];
      return new Type(views.get(a.bufferView),a.byteOffset||0,a.count*({SCALAR:1,VEC2:2,VEC3:3,VEC4:4})[a.type]);
    }
    return {read,meshes:doc.meshes};
  });
  const primitives=accessor.meshes[ref.mesh].primitives;
  const selected=ref.vertices ? [primitives[0]] : primitives.slice(ref.first,ref.first+ref.count);
  const attrs=selected[0].attributes;
  if(ref.instances)return {positions:accessor.read(attrs._INSTANCE_POSITION),data:accessor.read(attrs._INSTANCE_DATA)};
  const pos=accessor.read(attrs.POSITION),norm=attrs.NORMAL!=null && accessor.read(attrs.NORMAL),tex=attrs.TEXCOORD_0!=null && accessor.read(attrs.TEXCOORD_0);
  const position=[],normal=[],uv=[],indices=[],remap=new Map();
  for(const faces of ref.vertices?[ref.vertices]:selected.map(p=>accessor.read(p.indices))){
    for(const id of faces){
      if(!Number.isInteger(id)||id<0||id*3>=pos.length)throw Error('Invalid effect vertex: '+url);
      if(!remap.has(id)){
        remap.set(id,remap.size);
        position.push(pos[id*3],pos[id*3+1],pos[id*3+2]);
        normal.push(norm?norm[id*3]:0,norm?norm[id*3+1]:0,norm?norm[id*3+2]:1);uv.push(tex?tex[id*2]:0,tex?tex[id*2+1]:0);
      }
      indices.push(remap.get(id));
    }
  }
  if(ref.reversed)for(let i=0;i<indices.length;i+=3)[indices[i],indices[i+2]]=[indices[i+2],indices[i]];
  return {position,normal,uv,indices};
}
