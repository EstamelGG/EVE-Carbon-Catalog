import {Box3,InstancedBufferGeometry,InstancedBufferAttribute,Mesh,Matrix4,Quaternion,Sphere,Vector3} from 'three';

const fields=[['transform1','layer1Transform',4],['transform2','layer2Transform',4],
 ['scroll1','layer1Scroll',4],['scroll2','layer2Scroll',4],['blinkData','blinkData',4],
 ['lightColor','color',3],['maskAtlasID','maskAtlasID',1]];
export function groupPlaneSets(sets){
  const groups = new Map();
  for (const set of sets) {
    const materialKey = JSON.stringify([set.textures, set.planeData, !!set.hologram]);
    for (const plane of set.planes) {
      // An unbound plane stays in the parent's coordinate system. A bound
      // batch can move as one object because all its planes use the same joint.
      const boneIndex = set.skinned ? (plane.boneIndex ?? -1) : -1;
      const key = materialKey + '/' + boneIndex;
      if (!groups.has(key)) groups.set(key, { ...set, boneIndex, planes: [] });
      groups.get(key).planes.push(plane);
    }
  }
  return [...groups.values()];
}

// Authored light planes: per-instance parameters preserve scrolling,
// blink phase, atlas index and color. Spatial chunks retain useful culling.
export function createPlaneBatches(set,textures,resources,fragment){
 const varying=fields.map(([name,,size])=>`flat out ${size===1?'float':`vec${size}`} ${name};`).join('\n');
 const attributes=fields.map(([name,,size])=>`in ${size===1?'float':`vec${size}`} instance_${name};`).join('\n');
 const vertex=`in mat4 planeMatrix;${attributes}\n${varying}
 out vec2 planeUV;out vec3 viewPosition,planeNormal;
 void main(){mat4 mv=modelViewMatrix*planeMatrix;vec4 p=mv*vec4(position,1);
 planeUV=vec2(uv.x,1.0-uv.y);viewPosition=-p.xyz;planeNormal=mat3(mv)*vec3(0,0,1);
 ${fields.map(([name])=>`${name}=instance_${name};`).join('')}
 gl_Position=projectionMatrix*p;}`;
 const material=resources.additiveMaterial(vertex,fragment,{
  imageMap:{value:textures.ImageMap||null},layer1Map:{value:textures.Layer1Map},
  layer2Map:{value:textures.Layer2Map},maskMap:{value:textures.MaskMap},
  planeData:{value:set.planeData},time:{value:0},
 });
 const planes=[...set.planes].sort((a,b)=>(a.position?.[0]||0)-(b.position?.[0]||0));
 const base=resources.plane();base.computeBoundingBox();
 const matrix=new Matrix4(),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
 const objects=[];
 for(let start=0;start<planes.length;start+=128){
  const chunk=planes.slice(start,start+128),geometry=resources.own(new InstancedBufferGeometry());
  geometry.index=base.index;geometry.attributes={...base.attributes};geometry.instanceCount=chunk.length;
  const transforms=new Float32Array(chunk.length*16),bounds=new Box3();
  const values=fields.map(([, ,size])=>new Float32Array(chunk.length*size));
  chunk.forEach((item,i)=>{
   matrix.compose(position.fromArray(item.position||[0,0,0]),rotation.fromArray(item.rotation||[0,0,0,1]),scale.fromArray(item.scaling||[1,1,1]));
   matrix.toArray(transforms,i*16);bounds.union(base.boundingBox.clone().applyMatrix4(matrix));
   fields.forEach(([,key,size],j)=>{
    const value=item[key]??(key==='color'?[1,1,1]:size===1?0:[0,0,0,0]);
    values[j].set(size===1?[value]:value.slice(0,size),i*size);
   });
  });
  geometry.setAttribute('planeMatrix',new InstancedBufferAttribute(transforms,16));
  fields.forEach(([name,,size],i)=>geometry.setAttribute('instance_'+name,new InstancedBufferAttribute(values[i],size)));
  geometry.boundingBox=bounds;geometry.boundingSphere=bounds.getBoundingSphere(new Sphere());
  const object=new Mesh(geometry,material);object.name='EVE plane batch';object.matrixAutoUpdate=false;
  objects.push(object);
 }
 return objects;
}
