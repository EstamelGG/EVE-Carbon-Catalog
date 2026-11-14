import { Group, Matrix4 } from 'three';
import { equipmentAnimation } from './equipment-animation.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// Carbon row-vector matrices flatten directly into Three's column-major
// representation. Preserve source matrices here; equipment placement uses
// unit locator axes, matching CCP's EveTurretSet.UpdateItemsFromLocators.
export const HARDPOINT_PREFIXES=['locator_turret_','locator_launcher_','locator_bomb_','locator_xl_','locator_moonharvester_'];

export function equipmentLocatorName(item={}) {
 return typeof item.locatorName==='string'?item.locatorName.toLowerCase().replace(/[0-9]+$/,''):'';
}

export function groupHardpoints(locators) {
 const slots=new Map(),names=new Set();
 for(const locator of locators){
  const match=/^(locator_(?:turret|launcher|bomb|xl|moonharvester)_)(\d+)([a-z]*)$/i.exec(locator.name||'');
  if(!match)continue;
  // Trinity's FindLocatorTransformByName selects the first match in source order.
  const name=locator.name.toLowerCase();
  if(names.has(name))continue;
  const prefix=match[1].toLowerCase(),slot=Number(match[2]),matrix=locator.transform?.flat();
  if(slot<1||!matrix||matrix.length!==16||!matrix.every(Number.isFinite))
   throw Error('Invalid turret locator: '+locator.name);
  names.add(name);
  if(!slots.has(slot))slots.set(slot,{slot,mounts:[],types:{}});
  const definition=slots.get(slot);
  (definition.types[prefix]??=[]).push({name:locator.name,matrix});
 }
 // An empty slot must expose all its physical locations. Capital hulls can
 // have ordinary top/bottom turrets and separate side XL mounts at the same ID.
 // Share a label only when the complete transforms match across families.
 for(const definition of slots.values()){
  const positions=new Map();
  definition.mounts=[];
  for(const prefix of HARDPOINT_PREFIXES)for(const mount of definition.types[prefix]||[]){
   const key=JSON.stringify(mount.matrix);
   if(!positions.has(key))positions.set(key,prefix);
   if(positions.get(key)===prefix)definition.mounts.push(mount);
  }
 }
 // Some hulls repeat the same complete mount layout under several slot IDs.
 // Expose one physical group to both the bubbles and the equipment picker.
 // Compare every supported type, including absent types, so equal turret
 // layouts cannot hide distinct launcher/bomb slots. Mount order is immaterial.
 const layouts=new Map();
 for(const group of [...slots.values()].sort((a,b)=>a.slot-b.slot)){
  const key=JSON.stringify(HARDPOINT_PREFIXES.map(prefix=>
   (group.types[prefix]||[]).map(m=>JSON.stringify(m.matrix)).sort()));
  const existing=layouts.get(key);
  if(existing)existing.aliases.push(group.slot);
  else{group.aliases=[group.slot];layouts.set(key,group);}
 }
 return [...layouts.values()];
}

export function selectHardpoints(slots,slot,prefix) {
 if(!HARDPOINT_PREFIXES.includes(prefix))throw Error('Unsupported equipment locator: '+prefix);
 const definition=slots.find(s=>s.slot===slot);
 const mounts=definition?.types?.[prefix];
 if(!mounts?.length)throw Error('Missing hardpoint slot: '+prefix+slot);
 return mounts;
}

export function canFitEquipment(slots,slot,equipment,hullCategory=6) {
 if(!equipment||equipment.supported===false)return false;
 // Keep ship and structure equipment separate; do not apply hull allowlists.
 const equipmentCategory=hullCategory===6?7:hullCategory===65?66:null;
 if(equipmentCategory===null||equipment.categoryID!==equipmentCategory)return false;
 try{return selectHardpoints(slots,slot,equipmentLocatorName(equipment)).length>0;}
 catch{return false;}
}

// UI rows are logical equipment slots. Native locator numbers are local to
// each equipment family, so launcher_1 and bomb_1 can coexist in different rows.
export function planEquipmentPlacements(slots,choices,equipment,hullCategory=6,previous=new Map()) {
 const poseKey=mount=>{
  const source=new Matrix4().fromArray(mount.matrix);
  return new Matrix4().extractRotation(source).copyPosition(source).elements.join(',');
 };
 const requests=[...choices].filter(([,id])=>id!=null).map(([row,id])=>{
  const item=equipment.find(e=>e.id===id),prefix=equipmentLocatorName(item);
  const candidates=slots.filter(s=>canFitEquipment(slots,s.slot,item,hullCategory)).map(s=>({
   row,id,prefix,nativeSlot:s.slot,mounts:s.types[prefix],keys:s.types[prefix].map(poseKey),
  }));
  const old=previous.get(row);
  candidates.sort((a,b)=>Number(b.nativeSlot===old?.nativeSlot&&prefix===old?.prefix)-Number(a.nativeSlot===old?.nativeSlot&&prefix===old?.prefix)||a.nativeSlot-b.nativeSlot);
  return {row,candidates,stable:candidates.some(c=>old?.id===id&&old.nativeSlot===c.nativeSlot)};
 }).sort((a,b)=>a.candidates.length-b.candidates.length||Number(b.stable)-Number(a.stable)||a.row-b.row);
 const plan=new Map(),occupied=new Set(),families=new Set();
 function assign(index){
  if(index===requests.length)return true;
  for(const candidate of requests[index].candidates){
   const family=candidate.prefix+candidate.nativeSlot;
   if(families.has(family)||candidate.keys.some(key=>occupied.has(key)))continue;
   families.add(family);candidate.keys.forEach(key=>occupied.add(key));plan.set(candidate.row,candidate);
   if(assign(index+1))return true;
   families.delete(family);candidate.keys.forEach(key=>occupied.delete(key));plan.delete(candidate.row);
  }
  return false;
 }
 if(!assign(0))throw Error('No free compatible equipment mounts');
 return plan;
}

// Published equipment previews contain two mirrored mounts. Load just the
// first mount's original hierarchy, and its animation channels, for fitting.
export function singleEquipmentDocument(document) {
 if(document.extras?.ccpdec?.renderKind!=='equipment')throw Error('Not an equipment model');
 const doc=structuredClone(document),roots=doc.scenes[doc.scene||0].nodes;
 if(roots.length!==2||!doc.nodes[roots[0]].children)throw Error('Missing equipment preview mounts');
 const nodes=doc.nodes[roots[0]].children,reachable=new Set();
 function visit(index){if(reachable.has(index))return;reachable.add(index);for(const child of doc.nodes[index].children||[])visit(child);}
 nodes.forEach(visit);
 doc.scenes=[{nodes}];doc.scene=0;
 for(const animation of doc.animations||[])animation.channels=animation.channels.filter(c=>reachable.has(c.target.node));
 return doc;
}

export function createEquipmentMounts(root,slots,loadEquipment) {
 const entries=new Map(),revisions=new Map();let disposed=false,deployed=true;
 function release(entry){
  if(!entry)return;
  for(const instance of entry.instances){
   instance.animation?.dispose();
   const skeletons=new Set();instance.model.traverse(o=>{if(o.skeleton)skeletons.add(o.skeleton);});
   skeletons.forEach(s=>s.dispose());
  }
  entry.group.removeFromParent();
 }
 return {
  async set(slot,id,{nativeSlot=slot}={}){
   if(disposed)throw Error('Mounts disposed');
   const definition=slots.find(s=>s.slot===nativeSlot);if(!definition)throw Error('Unknown hardpoint slot');
   const revision=(revisions.get(slot)||0)+1;revisions.set(slot,revision);
   if(id==null){release(entries.get(slot));entries.delete(slot);return true;}
   const asset=await loadEquipment(id);
   if(disposed||revisions.get(slot)!==revision)return false;
   const selected=selectHardpoints(slots,nativeSlot,equipmentLocatorName(asset));
   const group=new Group();group.name='Equipment slot '+slot;
   const entry={id,group,nativeSlot,prefix:equipmentLocatorName(asset),mounts:selected,instances:[]};
   try{
    for(const mount of selected){
     const source=new Matrix4().fromArray(mount.matrix);
     for(const offset of [0,4,8])if(Math.hypot(...mount.matrix.slice(offset,offset+3))===0)throw Error('Degenerate hardpoint axes: '+mount.name);
     const holder=new Group();holder.name=mount.name;
     holder.matrix.extractRotation(source).copyPosition(source);holder.matrixAutoUpdate=false;
     const model=clone(asset.scene);holder.add(model);group.add(holder);
     const instance={model,animation:null};
     entry.instances.push(instance);
     instance.animation=equipmentAnimation(model,asset.animations);
     instance.animation.pose(deployed,false);
    }
    release(entries.get(slot));root.add(group);entries.set(slot,entry);return true;
   }catch(error){release(entry);throw error;}
  },
  setDeployed(value,transition=true){
   if(deployed===Boolean(value))return;
   deployed=Boolean(value);
   for(const entry of entries.values())for(const instance of entry.instances)instance.animation.pose(deployed,transition);
  },
  update(delta){
   let moving=false;
   for(const entry of entries.values())for(const instance of entry.instances)if(instance.animation.update(delta))moving=true;
   return moving;
  },
  get(slot){return entries.get(slot);},
  get count(){return [...entries.values()].reduce((sum,e)=>sum+e.instances.length,0);},
  dispose(){disposed=true;for(const e of entries.values())release(e);entries.clear();},
 };
}

export function createAutomaticEquipmentMounts(root,nativeSlots,equipment,loadEquipment,hullCategory=6) {
 let container=new Group(),mounts=createEquipmentMounts(container,nativeSlots,loadEquipment),choices=new Map(),placements=new Map();
 let disposed=false,deployed=true,queue=Promise.resolve();const fitCache=new Map();root.add(container);
 const supports=item=>nativeSlots.some(s=>canFitEquipment(nativeSlots,s.slot,item,hullCategory));
 const available=equipment.some(supports);
 const slots=nativeSlots.map((_,index)=>({slot:index+1,mounts:[],available}));
 function plan(row,item){
  if(!slots.some(s=>s.slot===row)||!supports(item))throw Error('Unsupported equipment or row');
  const next=new Map(choices);next.set(row,item.id);
  return planEquipmentPlacements(nativeSlots,next,equipment,hullCategory,placements);
 }
 async function apply(next){
  if(disposed)return false;
  for(const row of next.keys())if(!slots.some(s=>s.slot===row))throw Error('Unknown equipment row');
  const planned=planEquipmentPlacements(nativeSlots,next,equipment,hullCategory,placements);
  // Prepare the entire new layout off-scene. Failed loads cannot remove or
  // relocate any currently fitted equipment, including other logical rows.
  const stagedContainer=new Group(),staged=createEquipmentMounts(stagedContainer,nativeSlots,loadEquipment);
  const startingDeployed=deployed;staged.setDeployed(deployed);
  const results=await Promise.allSettled([...planned].map(([row,p])=>staged.set(row,p.id,{nativeSlot:p.nativeSlot})));
  const failed=results.find(r=>r.status==='rejected');
  if(disposed||failed){staged.dispose();if(failed)throw failed.reason;return false;}
  if(deployed!==startingDeployed)staged.setDeployed(deployed,false);
  mounts.dispose();container.removeFromParent();
  container=stagedContainer;mounts=staged;choices=next;placements=planned;fitCache.clear();root.add(container);return true;
 }
 function enqueue(next){const task=queue.then(()=>apply(next()));queue=task.catch(()=>{});return task;}
 return {
  slots,supports,
  canFit(row,item){
   if(!supports(item))return false;
   const key=row+':'+equipmentLocatorName(item);
   if(!fitCache.has(key)){try{plan(row,item);fitCache.set(key,true);}catch{fitCache.set(key,false);}}
   return fitCache.get(key);
  },
  set(row,id){return enqueue(()=>{
   if(!slots.some(s=>s.slot===row))throw Error('Unknown equipment row');
   const next=new Map(choices);if(id==null)next.delete(row);else next.set(row,id);return next;
  });},
  replace(entries){const next=new Map(entries);return enqueue(()=>next);},
  get:row=>mounts.get(row),get count(){return mounts.count;},
  setDeployed(value){deployed=Boolean(value);mounts.setDeployed(deployed);},
  update:delta=>mounts.update(delta),
  dispose(){disposed=true;mounts.dispose();container.removeFromParent();},
 };
}
