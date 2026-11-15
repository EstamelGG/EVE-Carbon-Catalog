// Keep the geometry bytes session-owned. Each GLTFLoader parser gets its own
// document because it annotates materials, primitives and extension records.
export function sharedGlb(session, geometryURL) {
  return session.buffer(geometryURL, async () => {
    const bytes = await session.arrayBuffer(geometryURL, undefined, 'resourceModel');
    const view = new DataView(bytes);
    if (view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 ||
        view.getUint32(8,true)!==bytes.byteLength || view.getUint32(16,true)!==0x4e4f534a)
      throw Error('Invalid shared geometry GLB: '+geometryURL);
    const length=view.getUint32(12,true), bin=20+length;
    if (view.getUint32(bin+4,true)!==0x004e4942 || bin+8+view.getUint32(bin,true)!==bytes.byteLength)
      throw Error('Missing shared geometry buffer: '+geometryURL);
    return {json:new TextDecoder().decode(new Uint8Array(bytes,20,length)), buffer:bytes.slice(bin+8)};
  });
}
export async function parseSharedHull(loader, session, geometryURL, appearance) {
  const shared=await sharedGlb(session, geometryURL);
  const doc=JSON.parse(shared.json);
  const bonePalette=doc.extras?.ccpdec?.bonePalette;
  const {slotMaterials,materials,images,textures,samplers,extras}=appearance;
  for(const mesh of doc.meshes){
    mesh.primitives=mesh.primitives.filter(primitive=>{
      const slot=primitive.extras.materialIndex, material=slotMaterials[slot];
      if(material===null)return false;
      if(!materials[material])throw Error('Missing hull material slot '+slot);
      // Previously published shared hulls used a standard glTF color for
      // Carbon's shader input. Normalize it before both display and GLB export.
      const attrs=primitive.attributes;
      if(Object.hasOwn(attrs,'COLOR_0')){
        attrs._CCP_DIFFUSE_COLOR_0 ??= attrs.COLOR_0;
        delete attrs.COLOR_0;
      }
      primitive.material=material;
      return true;
    });
  }
  Object.assign(doc,{materials,images,extras:structuredClone(extras),
    samplers:samplers.map(s=>({...s,minFilter:9987})),
    textures:textures.map(t=>({sampler:t.sampler,extensions:{KHR_texture_basisu:{source:t.source}}}))});
  if(bonePalette)doc.extras.ccpdec.bonePalette=bonePalette;
  else if(doc.skins?.length && !doc.extras.ccpdec.bonePalette)
    doc.extras.ccpdec.bonePalette=doc.skins[0].joints.map(j=>doc.nodes[j].name);
  if(textures.length){
    doc.extensionsUsed.push('KHR_texture_basisu');
    doc.extensionsRequired.push('KHR_texture_basisu');
  }
  const embedded=parser=>{
    const load=parser.loadBuffer.bind(parser);
    parser.loadBuffer=index=>index===0 ? Promise.resolve(shared.buffer) : load(index);
    return {name:'EVE_shared_geometry'};
  };
  loader.register(embedded);
  try {return loader.parseAsync(JSON.stringify(doc),new URL('.',geometryURL).href);}
  finally {loader.unregister(embedded);}
}
