import {beforeSceneRender} from './effect-resources.js';
import {ambientAnimationLoop} from './page-activity.js';
import {skinnedPoseBounds} from './skinned-pose-bounds.js';
import {Box3, Sphere, AnimationClip,AnimationMixer,PropertyBinding} from 'three';

// Legacy glTF clips have names and keyframes but no autoplay flag. These are
// the viewer's ambient actions; dock/door/state clips retain their settled pose.
const ambientNames=new Set(['NormalLoop','Layer1Loop','LiftLoop']);
export function hangarAmbientClips(clips){
 return clips.filter(clip=>ambientNames.has(clip.name.split('.').pop())).map(clip=>{
  // Exported clips include constant tracks for the entire rig. Those tracks
  // must not blend away the settled dock/door pose or another ambient layer.
  const tracks=clip.tracks.filter(track=>{
   const size=track.getValueSize(),values=track.values;
   for(let i=size;i<values.length;i++)if(Math.abs(values[i]-values[i%size])>1e-6)return true;
   return false;
  });
  return new AnimationClip(clip.name,clip.duration,tracks);
 }).filter(clip=>clip.tracks.length);
}

// The published dock controller supplies an unmasked base and a binary mask
// read from its GR2 skeleton. Carbon applies that named mask to the layer:
// trinity/Controllers/Actions/Tr2ActionPlayMeshAnimation.cpp (f6f5ff8).
function dockClips(root, clips, dock) {
 const mask = new Set(dock.layerBones);
 const movingClips = [];
 for (const name of [dock.base, dock.layer]) {
  const clip = clips.find(c => c.name.split('.').pop() === name);
  if (!clip) throw Error('Missing dock animation: ' + name);
  const moving = [];
  for (const track of clip.tracks) {
   const parsed = PropertyBinding.parseTrackName(track.name);
   const node = PropertyBinding.findNode(root, parsed.nodeName);
   if (!node) throw Error('Missing dock animation node: ' + parsed.nodeName);
   const masked = mask.has(node.userData.name ?? node.name);
   if (masked !== (name === dock.layer)) continue;
   const size = track.getValueSize(), values = track.values;
   const constant = values.every((value, i) => Math.abs(value - values[i % size]) <= 1e-6);
   if (constant) {
    // Set fixed bones once. They remain available to the skin and do not
    // require a running action or compete for weights in the ambient layer.
    PropertyBinding.create(root, track.name, parsed).setValue(values, 0);
   } else {
    moving.push(track);
   }
  }
  if (moving.length) movingClips.push(new AnimationClip(clip.name, clip.duration, moving));
 }
 root.updateMatrixWorld(true);
 root.traverse(node => {
  if (node.isSkinnedMesh) {
   node.computeBoundingBox();
   node.computeBoundingSphere();
  }
 });
 return movingClips;
}

export function createHangarAnimation(root,clips,dock){
 const ambient=dock ? dockClips(root,clips,dock) : hangarAmbientClips(clips),mixer=new AnimationMixer(root),nodes=new Set();
 for(const clip of ambient)for(const track of clip.tracks){
  const node=PropertyBinding.findNode(root,PropertyBinding.parseTrackName(track.name).nodeName);
  if(node)nodes.add(node);
 }
 const affected=node=>{for(let p=node;p;p=p.parent)if(nodes.has(p))return true;return false;};
 const meshes=[];
 root.traverse(object=>{
  if(!object.isMesh||!(affected(object)||object.skeleton?.bones.some(affected)))return;
  const oldSphere=object.boundingSphere;
  meshes.push([object,object.frustumCulled,oldSphere]);object.userData.eveHangarAnimated=true;
  if(object.isSkinnedMesh){
   const bounds=new Box3(),sphere=new Sphere();
   object.frustumCulled=false;
   object.eveUpdatePoseBounds=()=>{
    if(skinnedPoseBounds(object,bounds)){
     bounds.getBoundingSphere(sphere);object.boundingSphere=sphere;object.frustumCulled=true;
    }else object.frustumCulled=false;
   };
  }else object.frustumCulled=false;
 });
 for(const clip of ambient)mixer.clipAction(clip).play();
 return {names:ambient.map(clip=>clip.name),update(seconds){mixer.update(seconds);},
  updateBounds(){for(const [mesh] of meshes)mesh.eveUpdatePoseBounds?.();},
  dispose(){mixer.stopAllAction();mixer.uncacheRoot(root);for(const [mesh,cull,oldSphere] of meshes){delete mesh.eveUpdatePoseBounds;mesh.boundingSphere=oldSphere;mesh.frustumCulled=cull;delete mesh.userData.eveHangarAnimated;}}};
}

export function installHangarAnimation(root,clips,scene,viewer,dock){
 const animation=createHangarAnimation(root,clips,dock);
 viewer.dataset.hangarAnimations=JSON.stringify(animation.names);
 let last=null;
 const loop=ambientAnimationLoop(scene, now=>{
  if(last!==null){animation.update(Math.max(0,(now-last)/1000));scene.queueRender();}
  last=now;
 },viewer.ownerDocument);
 const releaseBounds=beforeSceneRender(scene,()=>animation.updateBounds(),{first:true});
 if(animation.names.length)loop.start();
 return ()=>{loop.stop();releaseBounds();animation.dispose();};
}
