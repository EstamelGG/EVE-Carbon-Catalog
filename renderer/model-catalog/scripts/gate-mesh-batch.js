import {InstancedMesh,DynamicDrawUsage,Matrix4,Vector3} from 'three';
import {spatialChunks} from './spatial-chunks.js';

// Additive projector meshes can share a draw even when their placements and
// visibility animate. Alpha-blended clouds keep their individual sort order.
export function createGateMeshBatches(root,entries,animation){
  const animated=new Set(),mirrored=new Set();
  for(const set of animation.data.sets)for(const track of set.tracks){
    animated.add(track.target);
    if(track.field==='scaling'&&track.values.some(v=>v.some(x=>x<0)))mirrored.add(track.target);
  }
  const groups=new Map(),batches=[];
  for(const entry of entries){
    const {record,object}=entry,m=record.material;
    if(!['ubershader.fx','volumesphere.fx'].includes(m.shader)||m.blend!=='additiveAreas'||
      record.transforms.some(t=>mirrored.has(t.fxID)||(t.scaling||[]).some(v=>v<0)||
        (t.transformModifiers||[]).some(m=>/ModifierSRT|AttachToBone/.test(m.type))))continue;
    // Animated uniforms may share a batch only when they use the same targets,
    // not merely when their values happen to agree on the first frame.
    const bindings=Object.entries(m.fxParameters||{}).filter(([,id])=>animated.has(id)).sort(([a],[b])=>a.localeCompare(b));
    const key=JSON.stringify([object.geometry.uuid,m.shader,m.options,m.textures,animation.parameters(m),bindings,object.renderOrder,object.layers.mask]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(entry);
  }
  for(const entries of groups.values()){
    if(entries.length<2)continue;
    // Bounded batches retain useful frustum culling in large modular rooms.
    const positions=new Map(entries.map(e=>[e,new Vector3().setFromMatrixPosition(e.object.matrix)]));
    for(const items of spatialChunks(entries,64,e=>positions.get(e))){
      const source=items[0].object;
      if(items.length<2)continue;
      const mesh=new InstancedMesh(source.geometry,source.material,items.length);
      mesh.name='EVE hangar projector batch';mesh.matrixAutoUpdate=false;
      mesh.renderOrder=source.renderOrder;mesh.layers.mask=source.layers.mask;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.visible=false;
      for(const item of items){item.object.removeFromParent();item.batched=true;item.batchLeader=item===items[0];}
      root.add(mesh);batches.push({mesh,items,previous:items.map(()=>({matrix:new Matrix4(),object:null}))});
    }
  }
  return {
    update(){for(const {mesh,items,previous} of batches){
      let count=0,changed=false;
      for(const {object} of items){
        if(!object.visible)continue;
        const i=count++,last=previous[i];
        if(last.object!==object||!last.matrix.equals(object.matrix)){
          mesh.setMatrixAt(i,object.matrix);last.matrix.copy(object.matrix);last.object=object;changed=true;
        }
      }
      const resized=mesh.count!==count;mesh.count=count;mesh.visible=count>0;
      if(changed)mesh.instanceMatrix.needsUpdate=true;
      // Hidden instances must not draw or stretch bounds back to the origin.
      if(count&&(changed||resized))mesh.computeBoundingSphere();
    }},
    dispose(){for(const {mesh,items} of batches){mesh.removeFromParent();mesh.dispose();for(const item of items){delete item.batched;delete item.batchLeader;}}},
  };
}
