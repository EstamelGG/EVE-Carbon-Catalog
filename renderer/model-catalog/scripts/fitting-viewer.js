import {pageAnimationLoop} from './page-activity.js';
import {$scene} from '@google/model-viewer/lib/model-viewer-base.js';
import {Box3,Box3Helper,Group,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ktx2Loader} from '@google/model-viewer/lib/three-components/CachingGLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {subsystemDocument} from './shared-hull.js';
import {createAutomaticEquipmentMounts,groupHardpoints,singleEquipmentDocument,equipmentLocatorName} from './equipment-hardpoints.js';
import {installNativePreview} from './native-viewer.js';
import {beforeSceneRender} from './effect-resources.js';
import {resourceURL} from '../src/resource-location.mjs';
import {layoutFittingLabels} from './fitting-label-layout.js';
import {fittingFocusPose,createEquipmentFocusCycle} from './fitting-focus.js';
import {focusAnnotation} from './annotation-focus.js';
import {loadArrayBuffer,trackResource} from '../src/resource-activity.mjs';
import {resolveFittingMaterial,applyFittingMaterial} from './fitting-materials.js';

export function installFitting(viewer,{locators,equipment,settings,hullCategory=6,appearance,dna=''}) {
 const materialProfile=resolveFittingMaterial(appearance,dna);
 const scene=viewer[$scene],root=new Group(),cache=new Map(),owned=new Set(),nativeDisposers=new Set();
 const nativeSlots=groupHardpoints(locators),layer=viewer.ownerDocument.createElement('div'),labels=[];
 const leaders=viewer.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg');leaders.classList.add('fitting-leaders');leaders.setAttribute('aria-hidden','true');
 const overlay=new Group(),outlines=[];
 overlay.name='Selected equipment outline';overlay.userData.eveEffects=true;overlay.matrixAutoUpdate=false;overlay.renderOrder=Infinity;
 scene.add(overlay);
 let disposed=false,preview=null,selected=null,last=0;
 const focusCycle=createEquipmentFocusCycle();
 const onCameraChange=event=>{if(event.detail?.source==='user-interaction')focusCycle.reset();};
 viewer.addEventListener('camera-change',onCameraChange);
 root.name='Fitted equipment';root.userData.eveFitting=true;root.userData.eveEffects=true;
 scene.model.add(root);
 layer.className='ship-annotations fitting-labels';layer.hidden=true;viewer.parentElement.append(layer);
 function collectParsed(parsed,resources){
  parsed.scene.traverse(o=>{
   for(const resource of [o.geometry,o.skeleton])if(resource)resources.add(resource);
   for(const material of Array.isArray(o.material)?o.material:[o.material]){
    if(!material)continue;resources.add(material);for(const value of Object.values(material))if(value?.isTexture)resources.add(value);
   }
  });
 }
 async function load(id){
  if(!cache.has(id))cache.set(id,(async()=>{
   const selection=equipment.find(e=>e.id===id);if(!selection)throw Error('Unknown equipment');
   const item=selection;
   const asset=await viewer.assetSession.json(item.asset);
   const url=new URL((viewer.assetSession?.resolveURL || resourceURL)(asset.model),location.href);url.searchParams.set('v',asset.modelRevision||'');
   const doc=applyFittingMaterial(singleEquipmentDocument(await subsystemDocument(viewer.assetSession,url.href,asset)),materialProfile,asset.fittingEquipment.authoredParameters);
   // Avoid matching hull materials when a later appearance update traverses the model.
   doc.materials?.forEach((m,i)=>m.name=`fitting_${id}_${i}`);
   const loader=new GLTFLoader().setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder);
   loader.register(parser=>{
    const buffer=parser.loadBuffer.bind(parser),image=parser.loadTextureImage.bind(parser);
    parser.loadBuffer=index=>{
     const definition=parser.json.buffers[index],uri=definition.uri;
     if(!uri||uri.startsWith('data:'))return buffer(index);
     const href=new URL(uri,url).href,key=JSON.stringify([href,definition.byteLength]);
     return viewer.assetSession.buffer(key,()=>loadArrayBuffer(href,undefined,'resourceModel'));
    };
    parser.loadTextureImage=(texture,index,textureLoader)=>{
     const uri=parser.json.images[index]?.uri;
     return uri&&!uri.startsWith('data:')
      ?trackResource(new URL(uri,url).href,()=>image(texture,index,textureLoader),'resourceTexture')
      :image(texture,index,textureLoader);
    };
    return {name:'EVE_fitting_resource_progress'};
   });
   const parsed=await loader.parseAsync(JSON.stringify(doc),new URL('.',url).href);
   parsed.locatorName=equipmentLocatorName({...item,locatorName:item.locatorName??doc.extras?.ccpdec?.locatorName});
   const resources=disposed?new Set():owned;
   collectParsed(parsed,resources);
   if(disposed){for(const resource of resources)resource.dispose();throw Error('Fitting disposed');}
   if(settings){
    const dispose=await installNativePreview(viewer,settings,url.href,id,dna,{root:parsed.scene,document:doc});
    if(disposed){dispose();throw Error('Fitting disposed');}nativeDisposers.add(dispose);
   }
   parsed.scene.traverse(o=>{if(o.isMesh)o.frustumCulled=false;});
   return parsed;
  })().catch(error=>{cache.delete(id);throw error;}));
  return cache.get(id);
 }
 const mounts=createAutomaticEquipmentMounts(root,nativeSlots,equipment,load,hullCategory,
  {model:scene.model,document:viewer.originalGltfJson}),slots=mounts.slots;
 const canFit=(slot,item)=>mounts.canFit(slot,item);
 function activeMounts(slot){return mounts.get(slot)?.mounts||[];}
 function updateVisibility(){
  layer.hidden=preview==null;
  if(layer.hidden)for(const outline of outlines)outline.visible=false;
  scene.queueRender();
 }
 // Model annotations have their own selection; they never address equipment rows.
 function focusLabel(label){
  if(!label||disposed)return false;
  selected=label.mount.name;
  focusAnnotation(viewer,fittingFocusPose({scene,root,mount:label.mount,model:label.model,orbit:viewer.getCameraOrbit()}));
  scene.queueRender();return true;
 }
 layer.addEventListener('click',event=>{
  const bubble=event.target.closest('button[data-mount]');
  if(!bubble||layer.hidden||disposed)return;
  const label=labels.find(label=>label.bubble===bubble);if(!label)return;
  event.stopPropagation();focusCycle.reset();focusLabel(label);
 });
 function refreshLabels(){
  focusCycle.reset();
  layer.replaceChildren(leaders);leaders.replaceChildren();labels.length=0;
  for(const native of nativeSlots)for(const mount of native.mounts){
   const bubble=viewer.ownerDocument.createElement('button');bubble.type='button';bubble.className='ship-annotation fitting-label';
   let displayMount=mount,model,row,instance;
   for(const logical of slots){
    const entry=mounts.get(logical.slot),index=entry?.mounts.findIndex(m=>m.name===mount.name||JSON.stringify(m.matrix)===JSON.stringify(mount.matrix));
    if(index>=0){displayMount=entry.mounts[index];instance=entry.instances[index];model=instance.model;
     row=logical.slot;break;}
   }
   const family=/^locator_(.+)_\d/i.exec(displayMount.name)?.[1].toUpperCase();
   bubble.textContent=family+' '+String(native.slot).padStart(2,'0')+(displayMount.name.match(/[a-z]+$/i)?.[0]||'a').toUpperCase();
   bubble.dataset.mount=displayMount.name;bubble.hidden=true;
   const line=viewer.ownerDocument.createElementNS('http://www.w3.org/2000/svg','polyline');line.style.display='none';leaders.append(line);layer.append(bubble);
   bubble.setAttribute('aria-pressed',String(selected===mount.name));
   labels.push({bubble,line,mount,model,row,instance,
    anchor:new Vector3().fromArray(mount.matrix,12)});
  }
 }
 refreshLabels();
 const point=new Vector3();
 const unsubscribe=beforeSceneRender(scene,camera=>{
  mounts.pose();
  if(layer.hidden||disposed)return;
  const models=preview==null?[labels.find(label=>label.mount.name===selected)?.model].filter(Boolean)
   :(mounts.get(preview)?.instances||[]).map(instance=>instance.model);
  while(outlines.length<models.length){
   const outline=new Box3Helper(new Box3(),0xc3d6df);
   outline.material.depthWrite=false;outline.material.depthTest=true;outline.material.transparent=true;
   outline.renderOrder=Infinity;outline.frustumCulled=false;
   outlines.push(outline);overlay.add(outline);
  }
  for(const [index,outline] of outlines.entries()){
   const model=models[index];outline.visible=Boolean(model);
   if(model){outline.box.setFromObject(model,true);outline.visible=!outline.box.isEmpty();}
  }
  // Bounds are in world space; cancel the scene transform for this overlay.
  overlay.matrix.copy(scene.matrixWorld).invert();overlay.updateMatrixWorld(true);
  const width=layer.clientWidth,height=layer.clientHeight,points=[];
  for(const [index,{bubble,line,anchor,row,instance}] of labels.entries()){
   if(instance)point.setFromMatrixPosition(instance.holder.matrix);else point.copy(anchor);
   root.localToWorld(point);point.project(camera);
   const visible=(preview==null||row===preview)&&point.z>=-1&&point.z<=1&&Math.abs(point.x)<=1&&Math.abs(point.y)<=1;
   bubble.hidden=!visible;line.style.display='none';
   if(visible)points.push({index,x:(point.x+1)*width/2,y:(1-point.y)*height/2,width:bubble.offsetWidth||100,height:bubble.offsetHeight||22});
  }
  const layout=layoutFittingLabels(points,width,height),placed=new Set(layout.map(p=>p.index));
  for(const {index,xLabel,yLabel,line:vertices} of layout){
   const label=labels[index];label.bubble.style.left=`${xLabel}px`;label.bubble.style.top=`${yLabel}px`;
   const active=preview==null?selected===label.mount.name:label.row===preview;
   label.bubble.classList.toggle('selected',active);label.bubble.setAttribute('aria-pressed',String(active));
   label.line.classList.toggle('selected',active);
   label.line.style.display='';label.line.setAttribute('points',vertices);
  }
  for(const [index,label] of labels.entries())if(!placed.has(index))label.bubble.hidden=true;
 });
 function tick(now){
  if(disposed)return false;
  const moving=mounts.update(Math.max(0,(now-last)/1000));last=now;scene.queueRender();
  return moving;
 }
 const animationLoop=pageAnimationLoop(tick,viewer.ownerDocument);
 function animate(){last=animationLoop.now();animationLoop.start();}
 return {
  dna,appearanceKey:materialProfile?.key||null,
  slots,activeMounts,canFit,supports:item=>mounts.supports(item),get:slot=>mounts.get(slot),get count(){return mounts.count;},
  async set(slot,id){
   if(id!=null&&!canFit(slot,equipment.find(e=>e.id===id)))throw Error('No free compatible equipment mounts');
   const changed=await mounts.set(slot,id);if(changed&&!disposed){refreshLabels();animate();scene.queueRender();}return changed;
  },
  async replace(choices){
   const changed=await mounts.replace(choices);
   if(changed&&!disposed){preview=null;selected=null;refreshLabels();animate();updateVisibility();}
   return changed;
  },
  setDeployed(value){mounts.setDeployed(value);animate();},
  focusSlot(slot){
   const entry=mounts.get(slot);if(!entry||disposed)return false;
   scene.updateMatrixWorld(true);
   const instance=entry.instances[focusCycle.next(entry.instances,scene.getCamera())];
   return instance?focusLabel(labels.find(label=>label.model===instance.model)):false;
  },
  previewSlot(slot){preview=mounts.get(slot)?slot:null;updateVisibility();},
  setEditing(value){if(!value){preview=null;focusCycle.reset();}updateVisibility();},
  dispose(){if(disposed)return;disposed=true;viewer.removeEventListener('camera-change',onCameraChange);focusCycle.reset();animationLoop.stop();unsubscribe();for(const outline of outlines)outline.dispose();overlay.removeFromParent();mounts.dispose();root.removeFromParent();layer.remove();for(const dispose of nativeDisposers)dispose();for(const resource of owned)resource.dispose();owned.clear();cache.clear();},
 };
}
