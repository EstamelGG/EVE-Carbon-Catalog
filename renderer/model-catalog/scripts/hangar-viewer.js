import {disposeAsset,newAsset,loadHangarAsset} from './hangar-asset.js';
import {$scene,$renderer} from '@google/model-viewer/lib/model-viewer-base.js';
import {$controls} from '@google/model-viewer/lib/features/controls.js';
import {Box3,Group,Matrix3,Matrix4,Quaternion,Sphere,Vector3} from 'three';
import {beforeSceneRender,createEffectResources} from './effect-resources.js';
import {loadReflectionSource} from './native-reflections.js';
import {hangarDockPose} from './hangar-docking.js';
import {hangarSourceRadius} from './hangar-metadata.js';
import {createHangarCamera,hangarCameraRange} from './hangar-camera.js';
import {installLightBudget} from './effect-performance.js';
import {createHangarLights,createDockLights,animateHangarLights} from './hangar-lighting.js';
import {buildRoomLightGrid} from './room-light-grid.js';
import {installHangarSurfaceLights} from './hangar-surface-lights.js';
import {planHangarResources} from './hangar-resource-plan.js';
import {concurrentMap} from './concurrent-map.js';
import {resourceURL} from '../src/resource-location.mjs';
import {applyPostprocessingSettings} from '../src/display-settings.mjs';
import {focusView,cancelViewReset,resetView,restoreFocusLimits} from '../src/view-reset.mjs';

// A room is a scene attachment. The displayed ship, fittings and subsystem
// meshes retain their identity while backgrounds change.
export function createHangarViewer(viewer,{item,settings}) {
 const resolveURL=viewer.assetSession?.resolveURL||resourceURL;
 const scene=viewer[$scene],model=scene.model,controls=viewer[$controls];
 const isShip=item.categoryID===6,root=new Group();root.name='Hangar environment';
 const hangarCamera=createHangarCamera(viewer,scene,controls);
 root.position.copy(model.position);root.quaternion.copy(model.quaternion);root.scale.copy(model.scale);
 model.parent.add(root);root.visible=false;
 scene.updateMatrixWorld(true);
 // ModelScene's measured hull excludes effect bounds and mounted equipment.
 // Using setFromObject(model) also measures flare planes and moves the dock.
 const center=scene.boundingBox.getCenter(new Vector3());
 model.parent.localToWorld(center);model.worldToLocal(center);
 const original={visible:model.visible,background:scene.background,near:scene.getCamera().near,far:scene.getCamera().far};
 const originalBudget=viewer.postprocessingBudget;
 function applyBudget(active){
  // The room is much heavier than the catalog hull's triangle count. Use
  // the established large-model AO/MSAA budget without lowering textures.
  if(!originalBudget)return;
  viewer.postprocessingBudget=active?{...originalBudget,msaa:Math.min(originalBudget.msaa,2),aoScale:Math.min(originalBudget.aoScale,.5)}:originalBudget;
  applyPostprocessingSettings(viewer);
 }
 const reflection=viewer.nativeMaterialContext.reflection;
 const lighting=viewer.nativeMaterialContext,originalSH=lighting.sh.value;
 const roomSH=new Float32Array(28);
 const originalRigVisible=lighting.lightRig?.visible;
 const uniforms=new Map(Object.entries(reflection.uniforms).map(([key,uniform])=>[key,uniform.value]));
 let revision=0,disposed=false,current=null,pending=null,pendingShip=null,mode='dock';
 const stage=value=>{viewer.dataset.hangarPhase=value;viewer.dispatchEvent(new CustomEvent('hangar-progress',{detail:value}));};
 const assetContext={viewer,scene,settings,resolveURL,stage};
 const bounds=object=>new Box3().setFromObject(object,false).getBoundingSphere(new Sphere());
 const plan=urls=>viewer.dispatchEvent(new CustomEvent('hangar-resource-plan',{detail:urls}));
 function applyEnvironment(source){
  for(const [key,uniform] of Object.entries(reflection.uniforms))uniform.value=source?source.uniforms[key]?.value??uniforms.get(key):uniforms.get(key);
  const grid=source&&current?.room.lightGrid,u=lighting.roomLights;
  u.eveRoomLights.value=grid?.texture??null;
  if(grid){
   u.eveRoomGridSize.value.copy(grid.dim);u.eveRoomGridOrigin.value.copy(grid.low);u.eveRoomCellSize.value=grid.cellSize;
  }else u.eveRoomGridSize.value.set(0,0,0);
  lighting.sh.value=source?roomSH:originalSH;
  if(lighting.lightRig)lighting.lightRig.visible=source?false:originalRigVisible;
 }
 function applyMode(){
  const active=!!current;root.visible=active;model.visible=active&&!isShip?false:original.visible;
  if(current?.ship)current.ship.root.visible=mode==='dock';
  if(current?.room.dockLights)current.room.dockLights.visible=isShip||!!current.ship&&mode==='dock';
  if(isShip)viewer.shipEffects?.setMode(active?'idle':'cruise');
  if(!isShip)viewer.shipEffects?.setVisible(!active&&viewer.displaySettings?.effects!==false);
  const wasActive=viewer.hangarActive;
  viewer.hangarActive=active;
  // Older room manifests predate this field. Trinity's scene default is 0.5.
  viewer.querySelector('eve-scene-sharpening')?.setStrength(active ? current.entry.environment.sharpeningStrength ?? .5 : 0);
  applyBudget(active);
  scene.queueRender();
  if(wasActive!==active)viewer.dispatchEvent(new CustomEvent('hangar-mode-change'));
 }
 function place(next){
  const ship=next.ship?.root;
  if(ship){ship.position.set(0,0,0);ship.quaternion.identity();ship.updateMatrixWorld(true);}
  const box=isShip?scene.boundingBox.clone().applyMatrix4(model.matrix.clone().invert()):
   next.ship?.hullBox?.clone()??new Box3(new Vector3(-50,-50,-50),new Vector3(50,50,50));
  const authoredRadius=hangarSourceRadius(isShip?(viewer.appearanceDocument||viewer.originalGltfJson)?.extras?.ccpdec:next.ship?.sourceBounds,
   isShip?item:next.ship?.entry,next.hullMetadata);
  const radius=authoredRadius??box.getBoundingSphere(new Sphere()).radius;
  const dock=hangarDockPose(next.entry,isShip?item:next.ship?.entry||{},box,radius);
  next.shipBox=box.clone();
  next.room.stopDockLightNoise?.();
  next.room.dockLights?.removeFromParent();
  next.room.dockLights=createDockLights(next.entry.environment,radius,model.scale.x);
  next.room.stopDockLightNoise=animateHangarLights(next.room.dockLights,scene,viewer.ownerDocument);
  next.dock=dock;
  const room=next.room.root;
  if(isShip){room.quaternion.copy(dock.rotation).invert();room.position.copy(dock.position).applyQuaternion(room.quaternion).negate();}
  else{
   const localCenter=box.getCenter(new Vector3()).applyQuaternion(dock.rotation);
   room.quaternion.identity();room.position.copy(center).sub(dock.position).sub(localCenter);
   if(ship){ship.quaternion.copy(dock.rotation);ship.position.copy(center).sub(localCenter);}
  }
  if(isShip){
   next.room.dockLights.position.copy(dock.position);
   next.room.dockLights.quaternion.copy(dock.rotation);
   room.add(next.room.dockLights);
  }else if(ship)ship.add(next.room.dockLights);
  viewer.dataset.hangarDock=JSON.stringify({room:next.entry.key,source:dock.source,kind:dock.kind,platform:dock.platform,anchor:dock.anchor?.toArray(),lift:dock.lift,position:dock.position.toArray(),rotation:dock.rotation.toArray()});
 }
 function configureCamera(preserveView=false){
  // SkinnedMesh updates its inverse bind frame in updateMatrixWorld, not
  // updateWorldMatrix. Without this, newly attached large ships measure tiny.
  root.updateWorldMatrix(true,false);root.updateMatrixWorld(true);
  const scale=root.getWorldScale(new Vector3()).x;
  const radius=isShip?scene.boundingSphere.radius/scale:current.shipBox.getBoundingSphere(new Sphere()).radius;
  viewer.hangarFocusRadius=radius*scale;
  const range=hangarCameraRange(current.entry,radius,scene.aspect,scene.getCamera().near/scale);
  if(isShip){
   const home=Number(viewer.dataset.homeDistance)/scale;
   if(home>0){range.minimum=Math.min(range.minimum,home);range.maximum=Math.max(range.maximum,home);}
  }
  hangarCamera.configure(range,scale,{preserveView});
  return {range,scale};
 }
 function reset(instant=false){
  if(!current)return;
  restoreFocusLimits(viewer);
  if(isShip){
   const {range,scale}=configureCamera();
   viewer.cameraOrbit=`35deg 70deg ${range.distance*scale}m`;
   resetView(viewer,{reducedMotion:instant,preserveOrbit:true});return;
  }
  const {range,scale}=configureCamera();
  const target=root.localToWorld(center.clone());scene.target.worldToLocal(target);
  const distance=mode==='interior'?range.maximum:range.distance;
  // Capital docks sit at the entrance; view into the hall, not out into void.
  const theta=current.dock.kind==='capital'?.65:2.41;
  // Keep the room's zoom bounds; focusView's isolated-model bounds are not
  // appropriate for a camera inside architecture.
  focusView(viewer,{target,orbit:{theta,phi:1.28,radius:distance*scale}},{reducedMotion:instant,setRadiusLimits:()=>()=>{}});
 }
 async function setRoom(room,shipEntry,requestedMode='dock'){
  if(disposed)return false;
  const token=++revision;
  cancelPending();
  if(disposed||token!==revision)return false;
  if(!room){clear();return true;}
  const previous=current,next={room:newAsset(room),entry:room,ship:null};
  const transaction={next,previous,previousMode:mode,previousPhase:viewer.dataset.hangarPhase,previousDock:viewer.dataset.hangarDock};pending=transaction;
  const valid=()=>!disposed&&token===revision&&pending===transaction;
  let frameDock=!isShip&&!previous;
  const trackInput=event=>{if(event.detail?.source==='user-interaction')frameDock=false;};
  if(frameDock)viewer.addEventListener('camera-change',trackInput);
  function reveal(_asset,geometryComplete=false){
   if(!valid())return;
   if(current!==next){
    hangarCamera.setObstacles(null);
    place(next);if(previous){previous.room.root.visible=false;if(previous.ship)previous.ship.root.visible=false;}
    current=next;mode=requestedMode;root.add(next.room.root);if(next.ship)root.add(next.ship.root);
    root.updateWorldMatrix(true,false);root.updateMatrixWorld(true);
    next.reflection.uniforms.eve_cubeRotation.value.multiply(new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(next.room.root.getWorldQuaternion(new Quaternion()).invert())));
    applyEnvironment(next.reflection);applyMode();if(!valid())return;configureCamera(true);
    controls.updateNearFar(original.near,Math.max(original.far,model.scale.x*100000));
    scene.getCamera().near=original.near;scene.getCamera().updateProjectionMatrix();
   }
   if(geometryComplete){updateCameraBounds();hangarCamera.setObstacles(next.room.root);}
  }
  try{
   if(room.resourceBundles){
    // Keep preflight unsealed until loose dependencies are known as well.
    stage(room.key+':bundles');
    if(!valid())return false;
    await viewer.assetSession.bundles.prepare(room);
    if(!valid())return false;
   }
   const urls=await planHangarResources(viewer.assetSession,room,isShip?null:shipEntry);
   if(!valid())return false;
   plan([...urls]);
   if(!valid())return false;
   stage(room.key+':lighting');
   if(!valid())return false;
   next.room.resources=createEffectResources(undefined,resolveURL,viewer.assetSession.binaryURL);
   // These inputs are independent; all must settle before reveal or rollback.
   await concurrentMap([
    async()=>{if(room.hullMetadata)next.hullMetadata=await viewer.assetSession.json(resolveURL(room.hullMetadata));},
    async()=>{next.reflection=await loadReflectionSource(next.room.resources,{sunColor:room.environment.sunColor,diffuseIntensity:1},room.environment);},
    async()=>{if(room.environment.lighting)next.surfaceLighting=await viewer.assetSession.json(resolveURL(room.environment.lighting));},
    async()=>{if(!isShip&&shipEntry){next.ship=newAsset(shipEntry);await loadHangarAsset(assetContext,shipEntry,false,{result:next.ship,valid});}},
   ],load=>load(),{limit:3,isValid:valid});
   if(!valid()){disposeAsset(next.ship);return false;}
   const lights=createHangarLights(room,model.scale.x);
   next.room.architectureLights=lights;
   next.room.root.add(lights);
   next.room.stopRoomLightNoise=animateHangarLights(lights,scene,viewer.ownerDocument);
   const points=next.surfaceLighting?.stationaryPointLights??[],spots=next.surfaceLighting?.stationarySpotLights??[];
   if(points.length||spots.length){
    const grid=buildRoomLightGrid(points,viewer[$renderer].threeRenderer.capabilities.maxTextureSize,spots);
    if(grid){
     next.room.lightGrid=grid;next.room.owned.add(grid);
     const start=performance.now();
     next.room.stopGridUpdate=beforeSceneRender(scene,camera=>{
      if(current!==next)return;
      lighting.roomLights.eveViewToRoom.value.copy(next.room.root.matrixWorld).invert().multiply(camera.matrixWorld);
      grid.updateEmission?.((performance.now()-start)/1000);
     });
    }else{
      next.surfaceLighting={...next.surfaceLighting,lights:[...next.surfaceLighting.lights,...[...points,...spots].map(source=>({source,transforms:[]}))]};
    }
   }
   next.room.disposeSurfaceLights=installHangarSurfaceLights(scene,next.room.root,next.surfaceLighting,viewer.ownerDocument,lights,index=>next.room.boneAt ? next.room.boneAt(index) : null);
   next.room.disposeLights=installLightBudget(scene,lights);
   await loadHangarAsset(assetContext,room,true,{result:next.room,reveal,valid});
   if(!valid())return false;
   reveal(next.room,true);pending=null;
   disposeAsset(previous?.ship);disposeAsset(previous?.room);
   // Frame the berth on first entry from the exterior. Preserve an orbit
   // chosen during streaming, or carried over when switching backgrounds.
   if(frameDock)reset(true);
   else configureCamera(true);
   stage(room.key+':ready');return true;
  }catch(error){if(valid()){cancelPending();throw error;}disposeAsset(next.ship);disposeAsset(next.room);return false;}
  finally{viewer.removeEventListener('camera-change',trackInput);}
 }
 function updateCameraBounds(){
  root.updateWorldMatrix(true,false);root.updateMatrixWorld(true);
  const size=bounds(current.room.root),camera=scene.getCamera();
  const near=Math.min(original.near,model.scale.x*.5);
  controls.updateNearFar(near,Math.max(original.far,size.radius*8));
  camera.near=near;
  camera.updateProjectionMatrix();
 }
 function restoreDataset(key,value){if(value===undefined)delete viewer.dataset[key];else viewer.dataset[key]=value;}
 function cancelPending(){
  if(pendingShip){const {next,previousPhase}=pendingShip;pendingShip=null;disposeAsset(next);restoreDataset('hangarPhase',previousPhase);}
  if(!pending)return;
  const {next,previous,previousMode,previousPhase,previousDock}=pending;pending=null;
  const revealed=current===next;
  if(revealed){
   current=previous;mode=previousMode;if(previous){previous.room.root.visible=true;if(previous.ship)previous.ship.root.visible=mode==='dock';}
   applyEnvironment(previous?.reflection);
   if(previous){configureCamera(true);updateCameraBounds();hangarCamera.setObstacles(previous.room.root);}else{delete viewer.hangarFocusRadius;hangarCamera.restore();controls.updateNearFar(original.near,original.far);}
  }
  restoreDataset('hangarPhase',previousPhase);restoreDataset('hangarDock',previousDock);
  disposeAsset(next.ship);disposeAsset(next.room);
  if(revealed)applyMode();
 }
 async function setShip(entry){
  if(disposed)return false;
  const token=++revision;
  cancelPending();
  if(disposed||token!==revision||!current||isShip)return false;
  const owner=current,next=entry?newAsset(entry):null;
  const transaction={next,previousPhase:viewer.dataset.hangarPhase};pendingShip=transaction;
  const valid=()=>!disposed&&token===revision&&owner===current&&pendingShip===transaction;
  try{
   const urls=await planHangarResources(viewer.assetSession,null,entry);
   if(!valid())return false;
   plan([...urls]);
   if(!valid())return false;
   if(next)await loadHangarAsset(assetContext,entry,false,{result:next,valid});
   if(!valid()){disposeAsset(next);return false;}
   const previous=current.ship;current.ship=next;
   try{place(current);}catch(error){current.ship=previous;throw error;}
   if(next)root.add(next.root);
   pendingShip=null;disposeAsset(previous);applyMode();reset();stage(owner.entry.key+':ready');return true;
  }catch(error){if(valid()){cancelPending();throw error;}disposeAsset(next);return false;}
 }
 function clear(){
  cancelPending();
  delete viewer.hangarFocusRadius;
  ++revision;cancelViewReset(viewer);applyEnvironment(null);
  restoreFocusLimits(viewer);hangarCamera.restore();
  disposeAsset(current?.ship);disposeAsset(current?.room);current=null;
  controls.updateNearFar(original.near,original.far);applyMode();resetView(viewer);delete viewer.dataset.hangarDock;stage('idle');
 }
 return {setRoom,setShip,reset,setMode(value){if(disposed)return;mode=value;applyMode();reset();},
  setDockRange(name){return current?.room.effects?.sceneEffects?.setDockRange(name)??false;},
  setEffectsVisible(value){current?.room.effects?.setVisible(value);if(!isShip&&current)viewer.shipEffects?.setVisible(false);},
  get focusShip(){return !isShip&&mode==='dock'?current?.ship:null;},
  get active(){return !!current;},get selection(){return {room:current?.entry.key||'',ship:current?.ship?.entry.id,mode};},get exportRoot(){return current&&!isShip?root:null;},
  dispose(){if(disposed)return;disposed=true;++revision;cancelPending();cancelViewReset(viewer);restoreFocusLimits(viewer);hangarCamera.dispose();applyEnvironment(null);disposeAsset(current?.ship);disposeAsset(current?.room);current=null;applyMode();root.removeFromParent();controls.updateNearFar(original.near,original.far);delete viewer.hangarFocusRadius;delete viewer.dataset.hangarDock;stage('disposed');},
 };
}
