import {Quaternion,Vector3} from 'three';

// Local SOF ship locators, relative to the platform prefab, not the room.
// Resource names and hashes: docs/modular-berths.md. Only match the prefab
// actually placed at the selected room coordinate (several copies may exist).
const platforms=[
 {name:'mairpl_s_01a',kind:'small',position:[0,27,-168.68490600585938]},
 {name:'mairpl_m_01a',kind:'medium',position:[0,91.81919860839844,336.8150939941406],rotation:[0,.9999998807907104,0,-1.0000000116860974e-7]},
 {name:'mdepl_s_01a',kind:'small',position:[0,-.020935099571943283,-.04888070002198219]},
 {name:'mdepl_m_01a',kind:'medium',position:[-.6601563096046448,-.3714067041873932,-.20597140491008759]},
];
function platformAt(room,kind,dock){
 return platforms.find(p=>p.kind===kind&&room.locatorSets?.some(set=>
  (set.name===p.name||set.name===p.name+'_FOB'||set.name===p.name+'_deathless')&&
  set.locators.some(([pos])=>pos.every((v,i)=>Math.abs(v-dock.position[i])<.01))));
}
export function hangarDockPose(room,item,box,radius){
 const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),room.environment.rotationY||0);
 if(!room.modular){
  const support=box.getCenter(new Vector3());support.y=box.min.y;
  return {position:new Vector3(...room.environment.anchor).sub(support.applyQuaternion(rotation)),rotation,source:'anchorpoint'};
 }
 const size=Number(room.sizeClasses?.[item.groupID]??1),kind=size>=3?'capital':size>=2?'medium':'small';
 let selected=kind,dock=room.docks?.[kind];
 if(!dock){
  const substitute=kind==='small'?'small':'medium';
  const platform=platforms.filter(p=>p.kind===substitute).flatMap(p=>
   [p.name,p.name+'_FOB',p.name+'_deathless']).map(name=>room.locatorSets?.find(s=>s.name===name&&s.locators.length)).find(Boolean);
  if(platform){const [position,rotation]=platform.locators[0];selected=substitute;dock={position,rotation,source:platform.name};}
 }
 if(!dock){selected=['capital','medium','small'].find(key=>room.docks?.[key]);dock=room.docks?.[selected];}
 if(!dock)throw Error('机库缺少可用停靠点：'+room.key);
 rotation.fromArray(dock.rotation||[0,0,0,1]).normalize();
 const anchor=new Vector3(...dock.position),platform=platformAt(room,selected,dock);
 if(platform){
  anchor.add(new Vector3(...platform.position).applyQuaternion(rotation));
  if(platform.rotation)rotation.multiply(new Quaternion(...platform.rotation).normalize());
 }
 // Keep the hull's authored pivot along X/Z. AIR's locator is elevated;
 // Upwell's enclosed small berth already has a recessed floor. Open
 // Deathless decks and the common Upwell medium deck need hover clearance.
 const openDeck=platform?.name.startsWith('mdepl_')||(!platform&&selected==='medium'&&room.dna?.startsWith('mgenh_ow01:'));
 const lift=openDeck?Math.max(-box.min.y,.48*(radius??box.getSize(new Vector3()).length()/2)):
  platform?Math.max(0,-box.min.y-platform.position[1]):0;
 return {position:anchor.clone().add(new Vector3(0,lift,0).applyQuaternion(rotation)),rotation,
  source:dock.source,kind:selected,anchor,platform:platform?.name,lift};
}
