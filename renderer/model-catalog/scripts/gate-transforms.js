import { authoredLocal, applyAuthoredModifier } from './ship-authored-spotlights.js';
import { sourceBoneName } from './source-bones.js';

// Affine volume is unit dependent. Normalize each basis column separately so
// tiny authored parent scales remain drawable when a child expands again.
export function hasSpatialBasis(matrix) {
  const e=matrix.elements;
  for(let i=0;i<16;i++)if(!Number.isFinite(e[i]))return false;
  const sx=Math.max(Math.abs(e[0]),Math.abs(e[1]),Math.abs(e[2]));
  const sy=Math.max(Math.abs(e[4]),Math.abs(e[5]),Math.abs(e[6]));
  const sz=Math.max(Math.abs(e[8]),Math.abs(e[9]),Math.abs(e[10]));
  if (!sx||!sy||!sz) return false;
  const ax=e[0]/sx,ay=e[1]/sx,az=e[2]/sx,bx=e[4]/sy,by=e[5]/sy,bz=e[6]/sy;
  const cx=e[8]/sz,cy=e[9]/sz,cz=e[10]/sz;
  return ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx)!==0;
}
export function gateBones(document, model) {
  const palette=document.extras?.ccpdec?.bonePalette||[];
  // The exporter emits the palette from the primary geometry. Use glTF joint
  // identities to exclude unrelated skins added to the scene at runtime.
  const primarySkins=new Set((document.nodes||[]).filter(n=>n.mesh===0&&n.skin!==undefined).map(n=>n.skin));
  const jointIds=new Set([...primarySkins].flatMap(i=>document.skins?.[i]?.joints||[]));
  const bones=new Map(),unindexed=new Map();
  model.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    mesh.skeleton.bones.forEach((bone,i)=>{
      const nodeIndex=bone.userData?.associations?.nodes;
      if(jointIds.size&&nodeIndex!==undefined&&!jointIds.has(nodeIndex))return;
      const candidates=jointIds.size&&nodeIndex===undefined?unindexed:bones;
      const name=sourceBoneName(bone,document),inverse=mesh.skeleton.boneInverses[i];
      const existing=candidates.get(name);
      if(existing===undefined)candidates.set(name,{bone,inverse});
      else if(existing&&(existing.bone!==bone||!existing.inverse.equals(inverse)))candidates.set(name,null);
    });
  });
  return index => {
    const name = palette[index];
    if (name !== undefined) return (bones.has(name)?bones.get(name):unindexed.get(name)) ?? null;
  };
}

export function applyGateModifiers(world,modifiers,animation,root,eye,cameraRotation,boneAt,staticLocals){
  let visible=true;
  for(const sourceModifier of modifiers) {
    const modifier=animation.node(sourceModifier),type=modifier.type;
    if(type.endsWith('AttachToBone')) {
      const entry=boneAt(modifier.boneIndex);
      // A valid palette name missing from the exported skeleton has no usable pose.
      if(entry === null){visible=false;continue;}
      if(entry === undefined)continue;
      // Trinity applies the palette matrix in the incoming transform's local frame.
      const delta=root.matrixWorld.clone().invert().multiply(entry.bone.matrixWorld).multiply(entry.inverse);
      world.multiply(delta);
    } else if(staticLocals?.has(sourceModifier))world.multiply(staticLocals.get(sourceModifier));
    else applyAuthoredModifier(world,modifier,eye,cameraRotation);
  }
  return visible;
}

export function gateWorld(chain, animation, root, eye, cameraRotation, boneAt, memo,base=root.matrixWorld,staticLocals) {
  let world=base.clone(), visible=true,parentKey=base;
  for(const source of chain) {
    const key=source.fxID??source,cached=memo?.get(key);
    if(cached?.parent===parentKey){world.copy(cached.world);visible=cached.visible;parentKey=cached;continue;}
    const node=animation.node(source);
    visible &&=node.display!==false;
    const local=staticLocals?.get(source) ?? authoredLocal(node);
    world.multiply(local);
    if(!hasSpatialBasis(world))return {world,visible:false};
    if(node.transformModifiers?.length)visible=applyGateModifiers(world,node.transformModifiers,animation,root,eye,cameraRotation,boneAt,staticLocals)&&visible;
    if(memo){
      const entry={parent:parentKey,world:world.clone(),visible};
      memo.set(key,entry);parentKey=entry;
    }
  }
  return {world,visible:visible&&hasSpatialBasis(world)};
}
