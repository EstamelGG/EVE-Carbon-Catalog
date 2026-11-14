import {InstancedBufferGeometry,InstancedBufferAttribute,Mesh,DynamicDrawUsage,Vector2} from 'three';
import {flareVertex,flareFragment} from './lighting-shaders.js';

// Ordinary and soft flares each share one draw, while retaining independent
// animated transforms, colours and visibility. Depth remains source-authored.
export function createAnimatedFlareBatches(root,entries,resources){
 const batches=[];
 for(const soft of [false,true]){
  const items=entries.filter(e=>(e.record.shader==='flarequadsoft.fx')===soft);
  if(!items.length)continue;
  const plane=resources.plane(),geometry=resources.own(new InstancedBufferGeometry());
  geometry.index=plane.index;geometry.attributes={...plane.attributes};geometry.instanceCount=0;
  const attrs={};
  for(const [name,size] of [['flareCenter',3],['flareAxisX',3],['flareAxisY',3],['flareColor',3],['flareScale',1]]){
   attrs[name]=new InstancedBufferAttribute(new Float32Array(items.length*size),size).setUsage(DynamicDrawUsage);
   geometry.setAttribute(name,attrs[name]);
  }
  const vertex=flareVertex({instanced:true,softDepth:true});
  const fragment=flareFragment({instanced:true,softDepth:true,softFlare:soft});
  const material=resources.additiveMaterial(vertex,fragment,{
   effectSceneDepth:{value:null},effectHasDepth:{value:false},
   effectDepthSize:{value:new Vector2(1,1)},effectCameraRange:{value:new Vector2(.1,100)},
  });
  material.depthTest=false;material.forceSinglePass=true;
  const mesh=new Mesh(geometry,material);mesh.name=soft?'EVE soft flare batch':'EVE flare batch';
  mesh.frustumCulled=false;root.add(mesh);batches.push({items,attrs,mesh});
 }
 return {
  passes:batches.map(b=>b.mesh.material),
  update(){for(const {items,attrs,mesh} of batches){
   let count=0;
   for(const {object} of items){
    if(!object.visible)continue;
    const i=count++;
    const u=object.material.uniforms,e=u.localTransform.value.elements,m=object.matrix.elements,c=u.lightColor.value;
    attrs.flareCenter.setXYZ(i,m[12],m[13],m[14]);
    attrs.flareAxisX.setXYZ(i,e[0],e[1],e[2]);attrs.flareAxisY.setXYZ(i,e[4],e[5],e[6]);
    attrs.flareColor.setXYZ(i,c.x,c.y,c.z);
    attrs.flareScale.setX(i,u.parentScale.value);
   }
   mesh.geometry.instanceCount=count;mesh.visible=count>0;
   if(count)for(const attr of Object.values(attrs)){
    // Culled flares occupy the unused tail of the buffer.
    attr.clearUpdateRanges();attr.addUpdateRange(0,count*attr.itemSize);attr.needsUpdate=true;
   }
  }},
  dispose(){for(const {mesh} of batches)mesh.removeFromParent();},
 };
}
