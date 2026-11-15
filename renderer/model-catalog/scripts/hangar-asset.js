import {Box3,DoubleSide,Group} from 'three';
import {hangarModelURL} from './hangar-resource-plan.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {parseSharedHull} from './shared-hull.js';
import {installNativePreview} from './native-viewer.js';
import {installShipEffects} from './ship-effects.js';
import {bindHangarVideoLights} from './hangar-video-lights.js';
import {batchHangarGeometry} from './hangar-instances.js';
import {gateBones} from './gate-transforms.js';
import {installHangarAnimation} from './hangar-animation.js';
import {loadHangarGeometry} from './hangar-stream.js';

// Viewer-owned asset lifetime and streaming orchestration. Origin and review: docs/line-audit/renderer-origins.json.
export function disposeAsset(asset){if(!asset||asset.disposed)return;asset.disposed=true;asset.stopGridUpdate?.();asset.stopDockLightNoise?.();asset.stopRoomLightNoise?.();asset.dockLights?.removeFromParent();asset.disposeSurfaceLights?.();asset.disposeLights?.();asset.effects?.dispose();asset.disposeAnimation?.();asset.disposeBatches?.();asset.native?.();asset.resources?.dispose();asset.root.removeFromParent();for(const r of asset.owned||[])r.dispose();}
export const newAsset=entry=>({root:new Group(),entry,owned:new Set(),disposed:false});
export async function loadHangarAsset({viewer, scene, settings, resolveURL, stage}, entry, inside, {result, reveal=()=>{}, valid}){
  const alive=()=>!result.disposed&&valid();
  const check=()=>{if(!alive())throw Error('Hangar superseded');};
  const progress=value=>{check();stage(value);check();};
  // An installer can finish after its owner has been canceled. Release the
  // late handle immediately rather than disposing the whole asset twice.
  const retain=(key,value,release)=>{if(result.disposed)release(value);else result[key]=value;};
  const own=resource=>{if(result.owned.has(resource))return;result.owned.add(resource);if(result.disposed)resource.dispose();};
  const layoutNodes=new WeakSet();
  function prepareNode(node){node.traverse(o=>{
   if(inside)layoutNodes.add(o);
   if(inside&&o.userData.eveDockParent){
    o.visible=false;o.matrixAutoUpdate=false;(result.dockBodies??=[]).push(o);
   }
   if(o.geometry)own(o.geometry);if(o.skeleton)own(o.skeleton);
   for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){
    own(m);for(const value of Object.values(m))if(value?.isTexture)own(value);
    if(inside)m.side=DoubleSide;if(m.userData.eveNoObstacle){m.colorWrite=false;m.depthWrite=false;}
   }
   if(o.isMesh)o.frustumCulled=inside;
  });}
  try{
  const source=new URL(hangarModelURL(entry,resolveURL));
  const phaseKey=entry.key??String(entry.id);
  progress(phaseKey+':document');
  let document=structuredClone(entry.appearance || await viewer.assetSession.json(source.href));
  result.sourceBounds=document.extras?.ccpdec||{};
  if(!alive())throw Error('Hangar superseded');
  document.materials?.forEach((m,i)=>m.name=`hangar_${entry.id}_${i}`);
  progress(phaseKey+':geometry');
  // Native surfaces install their source maps below. Loading the portable
  // preview bindings first duplicates image decoding for every layout piece.
  const geometryDocument={...document,materials:(document.materials||[]).map(m=>({name:m.name,doubleSided:m.doubleSided,alphaMode:m.alphaMode,alphaCutoff:m.alphaCutoff,
    extras:{eveNoObstacle:m.extras?.ccpdecNative?.profile==='fx-surface-v1'},
    pbrMetallicRoughness:{baseColorFactor:[.12,.15,.18,1],metallicFactor:0,roughnessFactor:1}})),images:[],textures:[]};
  if (geometryDocument.extensionsRequired?.includes('MSFT_texture_dds'))
    geometryDocument.extensionsRequired = geometryDocument.extensionsRequired.filter(name => name !== 'MSFT_texture_dds');
  result.root.userData.eveEnvironment=inside;
  const parsed=inside?await loadHangarGeometry(geometryDocument,source.href,result.root,{valid:alive,arrayBuffer:viewer.assetSession.arrayBuffer,onNode(node){
    prepareNode(node);if(alive()){reveal(result);scene.queueRender();}
  }}):entry.appearance
    ?await parseSharedHull(new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),viewer.assetSession,source.href,geometryDocument)
    :await new GLTFLoader().parseAsync(JSON.stringify(geometryDocument),new URL('.',source).href);
  if(entry.appearance)document={...parsed.parser.json,materials:document.materials};
  if(!inside){
   result.root=parsed.scene;prepareNode(parsed.scene);
   // Measure the detached hull before flares and other effect geometry are attached.
   parsed.scene.updateMatrixWorld(true);result.hullBox=new Box3().setFromObject(parsed.scene,true);
  }
   if(!alive())throw Error('Hangar superseded');
   reveal(result,true);
   progress(phaseKey+':materials');
   retain('native',await installNativePreview(viewer,settings,source.href,entry.id,entry.dna||'',{root:parsed.scene,document,sharedTextures:false,progressive:inside,isValid:alive}),release=>release());
   if(!alive())throw Error('Hangar superseded');
   if(inside){result.disposeBatches=batchHangarGeometry(parsed.scene,{animations:parsed.animations,layoutNodes});
    result.disposeAnimation=installHangarAnimation(parsed.scene,parsed.animations,scene,viewer,entry.dockAnimation);
    result.boneAt=gateBones(document,parsed.scene);reveal(result,true);}
   progress(phaseKey+':effects');
   if(inside&&entry.effects)retain('effects',await installShipEffects(viewer,resolveURL(entry.effects),'idle',{parent:parsed.scene,sharedTextures:false,attachmentOwner:{model:parsed.scene,document},hangarBodies:result.dockBodies,
    bindPlaneVideos:videos=>{if(alive())return bindHangarVideoLights(result.architectureLights,videos,scene);}}),effects=>effects.dispose());
   if(!alive())throw Error('Hangar superseded');
   return result;
  }catch(error){disposeAsset(result);throw error;}
 }
