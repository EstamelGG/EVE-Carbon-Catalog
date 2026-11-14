import {Matrix4,Quaternion,Vector3} from 'three';
import {applyGateModifiers,hasSpatialBasis} from './gate-transforms.js';

import {authoredLocal} from './ship-authored-spotlights.js';

const poseFields=['translation','rotation','scaling','localTransform','staticTransform','useSRT','boneIndex'];
// Samples replace vectors and matrices instead of modifying earlier values.
function samePose(a,b){
  if(a===b)return true;
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(!samePose(a[i],b[i]))return false;
  return true;
}

function updateSignature(node,animation){
  let changed=false;
  for(const binding of node.watched){
    const {source,field}=binding,target=animation.targets[source.fxID];
    const value=target&&Object.hasOwn(target,field)?target[field]:source[field];
    if(!samePose(binding.previous,value))changed=true;
    binding.previous=value;
  }
  return changed;
}

// Compile shared layout ancestry once. Colour/brightness/display tracks do not
// invalidate spatial matrices; pose changes propagate by parent revision.
export function createGateTransformCache(paths,animation,root,eye,rotation,boneAt){
  const plan=animation.data.transformPlan,animated=new Set(plan?.version===1?plan.spatialTargets:[]);
  if(plan?.version!==1)for(const set of animation.data.sets)for(const track of set.tracks)if(poseFields.includes(track.field))animated.add(track.target);
  const staticLocals=new WeakMap();
  const origin={world:new Matrix4(),revision:0,visible:true,children:new Map()},leaves=new Map();
  const lastEye=new Vector3(Infinity,0,0),lastRotation=new Quaternion();
  let frame=0,cameraRevision=0,viewRevision=0;const stats={evaluations:0,nodes:0};
  for(const path of paths){
    let parent=origin;
    for(const source of path){
      const key=source.fxID??source;
      if(!parent.children.has(key)){
        const modifiers=source.transformModifiers||[],nodes=[source,...modifiers];
        for(const part of nodes){
          if(part!==source && !part.type.endsWith('ModifierSRT'))continue;
          if(!animated.has(part.fxID) && !staticLocals.has(part))staticLocals.set(part,authoredLocal(animation.node(part)));
        }
        const watched=[];
        for(const source of nodes){
          if(!animated.has(source.fxID))continue;
          const fields=animation.animatedFields?.get(source.fxID);
          for(const field of poseFields)if(!fields||fields.has(field))watched.push({source,field});
        }
        const timeDependent=parent.timeDependent || watched.length>0 || nodes.some(n=>
          animation.animatedFields?.get(n.fxID)?.has('display') || n.type?.endsWith('AttachToBone'));
        parent.children.set(key,{parent,timeDependent,viewRevision:-1,source,modifiers,local:staticLocals.get(source),children:new Map(),world:new Matrix4(),revision:0,frame:-1,
          parentRevision:-1,cameraRevision:-1,watched,visible:false,
          animated:nodes.some(n=>animated.has(n.fxID)),camera:modifiers.some(m=>/Billboard|Halo|CameraOriented/.test(m.type)),
          bone:modifiers.some(m=>m.type.endsWith('AttachToBone'))});stats.nodes++;
      }
      parent=parent.children.get(key);
    }
    leaves.set(path,parent);
  }
  const nextWorld=new Matrix4(),local=new Matrix4();
  function resolve(node){
    if(node===origin||node.frame===frame)return node;
    if(!node.timeDependent && node.viewRevision===viewRevision)return node;
    node.viewRevision=viewRevision;
    const parent=resolve(node.parent);node.frame=frame;
    const target=animation.targets[node.source.fxID];
    node.visible=parent.visible&&(target?.display??node.source.display)!==false;
    if(!node.visible)return node;
    const changed=node.animated && updateSignature(node,animation);
    if(node.parentRevision!==parent.revision||node.bone||node.camera&&node.cameraRevision!==cameraRevision||changed){
      nextWorld.multiplyMatrices(parent.world,node.local??authoredLocal(animation.node(node.source),local));
      node.poseVisible=hasSpatialBasis(nextWorld);
      if(node.poseVisible && node.modifiers.length){
        node.poseVisible=applyGateModifiers(nextWorld,node.modifiers,animation,root,eye,rotation,boneAt,staticLocals)&&hasSpatialBasis(nextWorld);
      }
      if(!node.world.equals(nextWorld)){node.world.copy(nextWorld);node.revision++;}
      node.parentRevision=parent.revision;node.cameraRevision=cameraRevision;stats.evaluations++;
    }
    // Singular matrices stay hidden even on frames which reuse the result.
    node.visible&&=node.poseVisible;return node;
  }
  return {stats,
    begin(){frame++;if(!origin.world.equals(root.matrixWorld)){origin.world.copy(root.matrixWorld);origin.revision++;viewRevision++;
        origin.visible=hasSpatialBasis(origin.world);}
      if(!lastEye.equals(eye)||!lastRotation.equals(rotation)){lastEye.copy(eye);lastRotation.copy(rotation);cameraRevision++;viewRevision++;}},
    world(path){const leaf=leaves.get(path);if(!leaf)throw Error('Unregistered effect transform path');return resolve(leaf);},
  };
}
