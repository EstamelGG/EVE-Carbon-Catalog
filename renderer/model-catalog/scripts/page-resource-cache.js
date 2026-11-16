import manifest from './page-cache-resources.json' with {type:'json'};

// Pin resources matching the configured path keywords. Keys retain the full origin,
// resource root and query version, rather than merging equal basenames.
export function createPageResourceCache(keywords=manifest.pathKeywords){
  const paths=[...new Set(keywords.map(value=>value.trim().toLowerCase()).filter(Boolean))],pending=new Map(),geometry=new Map();
  let resources,closed=false;
  const hot=url=>{try{const path=decodeURIComponent(new URL(url,globalThis.location?.href||'http://localhost/').pathname).toLowerCase();return paths.some(keyword=>path.includes(keyword));}catch{return false;}};
  return {
    hot,
    resources(create){if(closed)throw Error('Page cache closed');return resources??=create();},
    load(kind,url,create,resourceURL=url){
      if(closed||!hot(resourceURL))return Promise.resolve().then(create);
      const key=kind+' '+url;
      if(!pending.has(key))pending.set(key,Promise.resolve().then(create).catch(error=>{pending.delete(key);throw error;}));
      return pending.get(key);
    },
    geometry(url,create){
      if(closed||!hot(url))return null;
      if(!geometry.has(url))geometry.set(url,create());return geometry.get(url);
    },
    dispose(){if(closed)return;closed=true;resources?.dispose();for(const value of geometry.values())value.dispose();geometry.clear();pending.clear();},
  };
}
export const pageResourceCache=createPageResourceCache();
globalThis.addEventListener?.('pagehide',event=>{if(!event.persisted)pageResourceCache.dispose();});

// Let GLTFLoader keep its sampler/association bookkeeping on a private texture
// view while borrowing the page-owned decoded source.
export function shareGltfTextures(parser,session,modelURL){
  const load=parser.loadTextureImage.bind(parser);
  parser.loadTextureImage=(textureIndex,sourceIndex,loader)=>{
    const uri=parser.json.images[sourceIndex]?.uri;
    const url=uri&&new URL(uri,modelURL).href;
    if(!url||!pageResourceCache.hot(url))return load(textureIndex,sourceIndex,loader);
    const proxy={load(_url,onLoad,_progress,onError){session.resources.texture({url}).then(texture=>onLoad(texture.clone()),onError);}};
    return load(textureIndex,sourceIndex,proxy);
  };
}
