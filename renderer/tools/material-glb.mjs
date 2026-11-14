export function materialGlb(bytes, template, maps, MeshoptEncoder) {
  const input=Buffer.from(bytes), jsonSize=input.readUInt32LE(12);
  const doc=JSON.parse(input.subarray(20,20+jsonSize));
  const original=input.subarray(28+jsonSize);
  // The controlled encoder emits one homogeneous attribute or index stream per view.
  const accessors=new Map(doc.accessors.map(a=>[a.bufferView,a]));
  const chunks=[];
  let length=0;
  for (const [index,view] of doc.bufferViews.entries()) {
    const a=accessors.get(index);
    const stride=a ? ({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type])*(a.componentType===5123?2:4) : 4;
    const mode=view.target===34963?'INDICES':'ATTRIBUTES';
    const data=original.subarray(view.byteOffset,view.byteOffset+view.byteLength);
    const count=data.length/stride;
    const packed=MeshoptEncoder.encodeGltfBuffer(data,count,stride,mode);
    view.extensions={EXT_meshopt_compression:{buffer:0,byteOffset:length,byteLength:packed.length,byteStride:stride,count,mode}};
    view.buffer=1;
    chunks.push([length,packed]);
    length+=Math.ceil(packed.length/4)*4;
  }
  doc.buffers=[{byteLength:length},{...doc.buffers[0],extensions:{EXT_meshopt_compression:{fallback:true}}}];
  const bin=Buffer.alloc(8+length);
  bin.writeUInt32LE(length);bin.writeUInt32LE(0x004e4942,4);
  for (const [offset,data] of chunks) bin.set(data,offset+8);
  for (const mesh of doc.meshes) for (const prim of mesh.primitives) {
    prim.material=prim.extras.materialIndex;
    prim.attributes._CCP_SOURCE_POSITION=prim.attributes.POSITION;
  }
  const replace = (_,value) => typeof value==='string' && maps.has(value) ? maps.get(value).file : value;
  doc.materials=JSON.parse(JSON.stringify(template.materials,replace));
  doc.images=JSON.parse(JSON.stringify(template.images,replace));
  doc.textures=template.textures.map(t=>({sampler:t.sampler,extensions:{KHR_texture_basisu:{source:t.extensions?.EXT_texture_webp?.source??t.source}}}));
  doc.samplers=template.samplers.map(s=>({...s,minFilter:9987}));
  doc.extras=template.extras;
  doc.extensionsUsed=doc.extensionsRequired=['KHR_texture_basisu','EXT_meshopt_compression'];
  const json=Buffer.from(JSON.stringify(doc)), jsonLength=Math.ceil(json.length/4)*4;
  const header=Buffer.alloc(20+jsonLength,32);
  input.copy(header,0,0,20);header.writeUInt32LE(header.length+bin.length,8);header.writeUInt32LE(jsonLength,12);json.copy(header,20);
  return Buffer.concat([header,bin]);
}
