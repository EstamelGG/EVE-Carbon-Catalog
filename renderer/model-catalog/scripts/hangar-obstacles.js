import {Box3,Matrix4,Ray,Raycaster,Vector3,Mesh} from 'three';
import {createHangarRaycast} from './hangar-raycast.js';

function tree(entries){
 const box=new Box3();for(const entry of entries)box.union(entry.box);
 if(entries.length<=8)return {box,entries};
 const size=box.getSize(new Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
 entries.sort((a,b)=>a.center[axis]-b.center[axis]);const mid=Math.floor(entries.length/2);
 return {box,left:tree(entries.slice(0,mid)),right:tree(entries.slice(mid))};
}

// Broad-phase bounds are kept in room space. Exact mesh intersections run
// only for nearby candidates, not for every triangle in the entire hangar.
export function createHangarObstacles(root){
 root.updateWorldMatrix(true,true);
 const inverse=new Matrix4().copy(root.matrixWorld).invert(),local=new Matrix4(),entries=[];
 const raycasts=createHangarRaycast();
 root.traverseVisible(object=>{
  if(object.userData.eveEffects)return;
  for(let p=object;p&&p!==root;p=p.parent)if(p.userData.eveEffects)return;
  if(!object.isMesh)return;
  const materials=Array.isArray(object.material)?object.material:[object.material];
  if(!materials.some(m=>m.depthWrite&&m.depthTest&&!m.transparent))return;
  if(object.isSkinnedMesh){if(!object.boundingBox)object.computeBoundingBox();}
  else if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
  const source=object.isInstancedMesh?object.geometry.boundingBox:object.boundingBox||object.geometry.boundingBox;
  if(!source||source.isEmpty())return;
  local.multiplyMatrices(inverse,object.matrixWorld);
  const query=raycasts.prepare(object);
  const placements=object.isInstancedMesh?(object.hangarSourceMatrices||Array.from({length:object.count},(_,i)=>{
   const matrix=new Matrix4();object.getMatrixAt(i,matrix);return matrix;
  })):[null];
  // Index each placement separately. A ray near one wall should not traverse
  // all 64 copies in its rendering batch (including walls behind the camera).
  for(const placement of placements){
   const transform=local.clone();if(placement)transform.multiply(placement);
   const box=source.clone().applyMatrix4(transform);
   entries.push({object,placement,query,box,center:box.getCenter(new Vector3())});
  }
 });
 const moving=entries.filter(e=>e.object.userData.eveHangarAnimated);
 for(const entry of moving){

  if(entry.object.isSkinnedMesh){
   const object=entry.object,g=object.geometry,p=new Vector3(),indices=g.attributes.skinIndex,weights=g.attributes.skinWeight;
   entry.boneBounds=object.skeleton.bones.map(()=>new Box3());
   for(let i=0;i<g.attributes.position.count;i++){
    p.fromBufferAttribute(g.attributes.position,i).applyMatrix4(object.bindMatrix);
    for(let j=0;j<4;j++)if(weights.getComponent(i,j)>0)entry.boneBounds[indices.getComponent(i,j)].expandByPoint(p);
   }
  }
 }
 const hierarchy=tree(entries.filter(e=>!e.object.userData.eveHangarAnimated)),ray=new Ray(),caster=new Raycaster(),point=new Vector3(),end=new Vector3();
 const candidates=[],hits=[],world=new Matrix4(),proxy=new Mesh(),boneBox=new Box3(),boneMatrix=new Matrix4();
 // Shared skeletons need one matrix comparison per frame, even when several
 // material groups use the same bones. The static hierarchy never participates.
 const poses=new Map(),localWatch=new Box3();
 function watch(matrix){
  if(!poses.has(matrix))poses.set(matrix,{matrix,previous:null,changed:false});
  return poses.get(matrix);
 }
 for(const entry of moving){
  const object=entry.object;
  entry.poses=[watch(root.matrixWorld),watch(object.matrixWorld)];
  if(entry.boneBounds)entry.boneBounds.forEach((box,i)=>{
   if(!box.isEmpty())entry.poses.push(watch(object.skeleton.bones[i].matrixWorld));
  });
 }
 function prepare(worldWatch){
  inverse.copy(root.matrixWorld).invert();
  if(worldWatch)localWatch.copy(worldWatch).applyMatrix4(inverse);
  snapshot.changed=false;
  for(const pose of poses.values()){
   pose.changed=!pose.previous||!pose.matrix.equals(pose.previous);
   if(pose.changed){
    pose.previous??=new Matrix4();
    pose.previous.copy(pose.matrix);
   }
  }
  for(const entry of moving){
   if(!entry.poses.some(p=>p.changed))continue;
   const object=entry.object;
   if(worldWatch&&entry.box.intersectsBox(localWatch))snapshot.changed=true;
   local.multiplyMatrices(inverse,object.matrixWorld);
   if(entry.boneBounds){
    entry.box.makeEmpty();local.multiply(object.bindMatrixInverse);
    entry.boneBounds.forEach((box,i)=>{if(box.isEmpty())return;
     boneMatrix.copy(local).multiply(object.skeleton.bones[i].matrixWorld).multiply(object.skeleton.boneInverses[i]);
     entry.box.union(boneBox.copy(box).applyMatrix4(boneMatrix));
    });
   }else entry.box.copy(object.geometry.boundingBox).applyMatrix4(local);
   // Losing an old intersection matters just as much as entering the sight line.
   if(!worldWatch||entry.box.intersectsBox(localWatch))snapshot.changed=true;
  }
  return snapshot;
 }
 function distance(origin,direction,maximum,clearance=0,stats=null){
   if(!entries.length||maximum<=0)return maximum;
   ray.origin.copy(origin).applyMatrix4(inverse);
   end.copy(direction).multiplyScalar(maximum).add(origin).applyMatrix4(inverse);
   const localMaximum=end.distanceTo(ray.origin),ratio=maximum/localMaximum;
   ray.direction.copy(end).sub(ray.origin).normalize();candidates.length=0;
   for(const entry of moving){
    if(ray.intersectBox(entry.box,point))candidates.push({entry,distance:entry.box.containsPoint(ray.origin)?0:point.distanceTo(ray.origin)*ratio});
   }
   const visit=node=>{
    if(!ray.intersectBox(node.box,point)||(!node.box.containsPoint(ray.origin)&&point.distanceTo(ray.origin)>localMaximum))return;
    if(node.entries){for(const entry of node.entries)if(ray.intersectBox(entry.box,point))candidates.push({entry,distance:entry.box.containsPoint(ray.origin)?0:point.distanceTo(ray.origin)*ratio});}
    else{visit(node.left);visit(node.right);}
   };visit(hierarchy);candidates.sort((a,b)=>a.distance-b.distance);
   caster.set(origin,direction);caster.near=0;let nearest=maximum;
   for(const candidate of candidates){
    if(candidate.distance>nearest)break;
    caster.far=nearest;hits.length=0;const {object,placement,query}=candidate.entry;
    world.copy(object.matrixWorld);if(placement)world.multiply(placement);
    if(stats)stats.meshes++;
    if(query)nearest=Math.min(nearest,query(caster,world,nearest,stats));
    else {
     let collider=object;
     if(placement){proxy.geometry=object.geometry;proxy.material=object.material;proxy.matrixWorld.copy(world);collider=proxy;}
     collider.raycast(caster,hits);
     for(const hit of hits){
      const material=Array.isArray(object.material)?object.material[hit.face?.materialIndex]:object.material;
      if(material?.depthWrite&&material.depthTest&&!material.transparent&&hit.distance>1e-6)
       nearest=Math.min(nearest,hit.distance);
     }
    }
   }
   return nearest<maximum?Math.max(0,nearest-clearance):maximum;
 }
 const region=new Box3();
 function intersectsNode(node){
  if(!node.box.intersectsBox(region))return false;
  if(node.entries)return node.entries.some(entry=>entry.box.intersectsBox(region));
  return intersectsNode(node.left)||intersectsNode(node.right);
 }
 function intersectsRegion(worldBox){
  region.copy(worldBox).applyMatrix4(inverse);
  return intersectsNode(hierarchy)||moving.some(entry=>entry.box.intersectsBox(region));
 }
 const snapshot={changed:false,distance,intersectsRegion};
 return {count:entries.length,prepare,distance(...args){return prepare().distance(...args);}};
}
