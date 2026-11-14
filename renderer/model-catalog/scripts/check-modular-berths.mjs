import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Box3,Vector3,Quaternion} from 'three';
import {hangarDockPose} from './hangar-docking.js';

// Offline integration check against every room shipped in the supplied publication.
const root=path.resolve(process.argv[2]??'../.work/published');
const read=async name=>JSON.parse(await readFile(path.join(root,name),'utf8'));
const rooms=(await read('data/hangars.json')).hangars.filter(room=>room.modular);
assert(rooms.length>0);
const hull=new Box3(new Vector3(-10,-12,-55),new Vector3(24,18,72));
const group={small:25,medium:898,capital:30};
const near=(a,b)=>a.distanceTo(b)<.01;
let checked=0;
for(const room of rooms){
 const layout=await read(room.model);
 const nodes=layout.nodes;
 for(const [kind,entry] of Object.entries(room.docks)){
  const p=new Vector3(...entry.position),q=new Quaternion(...entry.rotation).normalize();
  const pose=hangarDockPose(room,{groupID:group[kind]},hull,80);
  assert.equal(pose.kind,kind,room.key);
  if(kind==='capital'){
   const marker=room.locatorSets.find(s=>s.name==='ship_placement').locators[0];
   assert(near(pose.position,new Vector3(...marker[0]))&&pose.rotation.angleTo(new Quaternion(...marker[1]))<1e-5);
  }else{
   const platforms=nodes.filter(n=>n.name===kind+'_dock_ships').flatMap(n=>n.children??[]).map(i=>nodes[i]);
   assert(platforms.some(n=>n.name==='Hull'&&n.matrix&&near(new Vector3().fromArray(n.matrix,12),p)),room.key+' selected an absent platform');
   const air=room.key==='air-modular',death=room.key.startsWith('deathless');
   const expected=air?(kind==='small'?[0,27,-168.684906]:[0,91.819199,336.815094]):
    death?(kind==='small'?[0,-.020935,-.048881]:[-.660156,-.371407,-.205971]):[0,0,0];
   assert(near(pose.anchor,new Vector3(...expected).applyQuaternion(q).add(p)),room.key+' anchor');
   if(air&&kind==='medium')q.multiply(new Quaternion(0,1,0,0));
   assert(pose.rotation.angleTo(q)<1e-5,room.key+' heading');
   assert(near(pose.position.clone().sub(pose.anchor).applyQuaternion(q.clone().invert()),new Vector3(0,pose.lift,0)));
   if(death||(!air&&kind==='medium'))assert(pose.lift+hull.min.y>0);
  }
  checked++;
 }
 console.log(room.key,Object.keys(room.docks).join('/'));
}
console.log('Verified',checked,'berths in',rooms.length,'modular rooms.');
