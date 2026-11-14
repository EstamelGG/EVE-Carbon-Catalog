import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadArrayBuffer} from '../src/resource-activity.mjs';

// A hangar document has independent layout roots sharing mesh/buffer caches.
// Attach each root when its own dependencies arrive, without reparsing buffers
// per layout placement. Keep the GLTFLoader integration in this boundary.
export async function loadHangarGeometry(document,url,root,{onNode=()=>{},plan=()=>{},valid=()=>true,arrayBuffer=loadArrayBuffer}={}){
 const base=new URL('.',url).href;
 plan((document.buffers||[]).filter(b=>b.uri&&!b.uri.startsWith('data:')).map(b=>new URL(b.uri,base).href));
 const loader=new GLTFLoader();
 loader.register(parser=>{
  const originalBuffer=parser.loadBuffer.bind(parser),originalScene=parser.loadScene.bind(parser);
  parser.loadBuffer=index=>{
   const uri=document.buffers[index].uri;
   return uri&&!uri.startsWith('data:')?arrayBuffer(new URL(uri,base).href,undefined,'resourceModel'):originalBuffer(index);
  };
  parser.loadScene=index=>{
   if(index!==(document.scene||0))return originalScene(index);
   const definition=document.scenes[index];root.name=definition.name||'Hangar layout';
   Object.assign(root.userData,definition.extras);
   return Promise.all((definition.nodes||[]).map(async id=>{
    const node=await parser.getDependency('node',id);
    onNode(node);
    if(valid())root.add(node);
   })).then(()=>root);
  };
  return {name:'EVE_progressive_hangar'};
 });
 return loader.parseAsync(JSON.stringify(document),base);
}
