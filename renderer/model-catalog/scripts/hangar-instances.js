import {InstancedMesh,Matrix4,Vector3,PropertyBinding} from 'three';
import {spatialChunks} from './spatial-chunks.js';
import {cacheStaticLayout} from './hangar-static-layout.js';

// Interior GLTFs reuse the same wall/platform meshes thousands of times.
// Batch only static, ordinary meshes; keep mirrored/animated geometry intact.
export function batchHangarGeometry(root,{animations=[],layoutNodes}={}){
 const animated=new Set(animations.flatMap(clip=>clip.tracks.map(track=>PropertyBinding.parseTrackName(track.name).nodeName)));
 if(animated.has(undefined)||animated.has(''))return ()=>{};
 const dynamic=object=>{for(let node=object;node;node=node.parent){if(animated.has(node.name)||animated.has(node.uuid))return true;if(node===root)break;}return false;};
 root.updateMatrixWorld(true);
 const inverse=root.matrixWorld.clone().invert(),matrix=new Matrix4(),position=new Vector3();
 const groups=new Map(),replaced=[],batches=[];
 root.traverseVisible(object=>{
  if(!object.isMesh||object.isSkinnedMesh||object.isInstancedMesh||object.morphTargetInfluences?.length||Array.isArray(object.material))return;
  if(dynamic(object)||object.children.length)return;
  matrix.multiplyMatrices(inverse,object.matrixWorld);
  if(matrix.determinant()<=0)return;
  const key=[object.geometry.uuid,object.material.uuid,object.renderOrder,object.layers.mask].join(':');
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({object,matrix:matrix.clone(),position:position.setFromMatrixPosition(matrix).clone()});
 });
 for(const entries of groups.values()){
  if(entries.length<2)continue;
  for(const chunk of spatialChunks(entries,64)){
   const source=chunk[0].object;
   const batch=new InstancedMesh(source.geometry,source.material,chunk.length);
   batch.hangarSourceMatrices=chunk.map(entry=>entry.matrix.clone());
   // Keep placements immutable. Three culls spatial batches without compacting
   // or uploading thousands of instance matrices whenever the camera moves.
   batch.name='EVE hangar geometry batch';batch.renderOrder=source.renderOrder;batch.layers.mask=source.layers.mask;
   chunk.forEach((entry,i)=>{batch.setMatrixAt(i,entry.matrix);replaced.push([entry.object,entry.object.parent]);entry.object.removeFromParent();});
   batch.instanceMatrix.needsUpdate=true;batch.computeBoundingBox();batch.computeBoundingSphere();
   batch.matrixAutoUpdate=false;root.add(batch);batches.push(batch);
  }
 }
 // Prune now-empty exporter transform chains, avoiding repeated world-matrix
 // walks in color, normal, soft-depth and bloom passes. Restore on disposal.
 // GLTFLoader also creates Bone nodes for skins declared in the document
 // but never bound to a rendered mesh. Retain all bound joints and tracks.
 const usedBones=new Set();
 root.traverse(object=>{
  if(object.isSkinnedMesh)for(const bone of object.skeleton.bones)usedBones.add(bone);
 });
 const empty=[];
 const prune=object=>{for(const child of [...object.children])prune(child);
  if(object!==root&&!object.children.length&&!dynamic(object)&&(object.isGroup||object.type==='Object3D'||(object.isBone&&!usedBones.has(object)))){
   empty.push([object,object.parent]);object.removeFromParent();
  }
 };
 prune(root);
 const releaseStatic=cacheStaticLayout(root,animated,layoutNodes);
 return ()=>{
  releaseStatic();
  for(const batch of batches){batch.removeFromParent();batch.dispose();}
  for(const [object,parent] of empty.reverse())parent.add(object);
  for(const [object,parent] of replaced)parent.add(object);
 };
}
