import {Box3,Vector3,Matrix4,Ray,BackSide,DoubleSide} from 'three';

// A shared, local-space triangle hierarchy. Build once while loading the room;
// orbiting only visits intersected nodes, without simplifying the geometry.
function triangleTree(geometry,subset){
 const position=geometry.attributes.position,index=geometry.index;
 const total=Math.floor((index?.count||position.count)/3),ids=subset?Uint32Array.from(subset):Uint32Array.from({length:total},(_,i)=>i),count=ids.length;
 const centers=new Float32Array(total*3),a=new Vector3(),b=new Vector3(),c=new Vector3();
 const vertex=(triangle,corner,target)=>target.fromBufferAttribute(position,index?index.getX(triangle*3+corner):triangle*3+corner);
 for(const i of ids){vertex(i,0,a);vertex(i,1,b);vertex(i,2,c);
  for(let axis=0;axis<3;axis++)centers[i*3+axis]=(a.getComponent(axis)+b.getComponent(axis)+c.getComponent(axis))/3;
 }
 function build(start,end){
  const box=new Box3();
  for(let i=start;i<end;i++)for(let corner=0;corner<3;corner++)box.expandByPoint(vertex(ids[i],corner,a));
  if(end-start<=12)return {box,start,end};
  const size=box.getSize(a),axis=size.x>=size.y&&size.x>=size.z?0:size.y>=size.z?1:2;
  ids.subarray(start,end).sort((x,y)=>centers[x*3+axis]-centers[y*3+axis]);
  const middle=(start+end)>>>1;return {box,left:build(start,middle),right:build(middle,end)};
 }
 const root=build(0,count),point=new Vector3();
 return (ray,maximum,material,stats)=>{
  let nearest=maximum;
  const groups=Array.isArray(material)?geometry.groups:null,draw=geometry.drawRange;
  function visit(node){
   if(!ray.intersectBox(node.box,point)||(!node.box.containsPoint(ray.origin)&&point.distanceTo(ray.origin)>nearest))return;
   if(node.left){visit(node.left);visit(node.right);return;}
   for(let i=node.start;i<node.end;i++){
    const triangle=ids[i],offset=triangle*3;
    if(offset<draw.start||offset+3>draw.start+draw.count)continue;
    const m=groups?material[groups.find(g=>offset>=g.start&&offset+3<=g.start+g.count)?.materialIndex]:material;
    if(!m||!m.depthWrite||!m.depthTest||m.transparent)continue;
    vertex(triangle,0,a);vertex(triangle,1,b);vertex(triangle,2,c);if(stats)stats.triangles++;
    const hit=m.side===BackSide?ray.intersectTriangle(c,b,a,true,point):ray.intersectTriangle(a,b,c,m.side!==DoubleSide,point);
    if(hit){const distance=point.distanceTo(ray.origin);if(distance>1e-6)nearest=Math.min(nearest,distance);}
   }
  }
  visit(root);return nearest;
 };
}

// Most room architecture has one rigid bone. Its deformation is exactly an
// affine transform, so thousands of placements can share one triangle tree.
function rigidGroups(geometry){
 const indices=geometry.attributes.skinIndex,weights=geometry.attributes.skinWeight;
 if(!indices||!weights)return null;
 const groups=new Map(),index=geometry.index,count=index?.count||indices.count;
 for(let i=0;i<count;i+=3){const vertices=[0,1,2].map(c=>index?index.getX(i+c):i+c),bones=vertices.map(v=>indices.getX(v));
  const rigid=vertices.every(v=>weights.getX(v)===1&&weights.getY(v)===0&&weights.getZ(v)===0&&weights.getW(v)===0)&&bones.every(b=>b===bones[0]);
  const bone=rigid?bones[0]:-1;
  if(!groups.has(bone))groups.set(bone,[]);groups.get(bone).push(i/3);
 }
 return groups;
}

export function createHangarRaycast(){
 const trees=new Map(),inverse=new Matrix4(),localRay=new Ray(),end=new Vector3(),matrix=new Matrix4();
 return {
  prepare(object){
   const geometry=object.geometry;
   if(object.morphTargetInfluences?.length)return null;
   const key=geometry.uuid+Boolean(object.isSkinnedMesh);
   if(!trees.has(key)){
    const groups=object.isSkinnedMesh?rigidGroups(geometry):new Map([[null,null]]);
    trees.set(key,groups?[...groups].map(([bone,subset])=>({bone,subset,query:bone===-1?null:triangleTree(geometry,subset)})):null);
   }
   const parts=trees.get(key);if(!parts)return null;
   return (caster,placement,maximum,stats)=>{
    let nearest=maximum;
    for(const {bone,query,subset} of parts){
    matrix.copy(placement);
    if(bone!==null&&bone!==-1)matrix.multiply(object.bindMatrixInverse).multiply(object.skeleton.bones[bone].matrixWorld)
     .multiply(object.skeleton.boneInverses[bone]).multiply(object.bindMatrix);
    if(Math.abs(matrix.determinant())<1e-15)continue;
    inverse.copy(matrix).invert();localRay.copy(caster.ray).applyMatrix4(inverse);
    end.copy(caster.ray.direction).multiplyScalar(nearest).add(caster.ray.origin).applyMatrix4(inverse);
    const localMaximum=end.distanceTo(localRay.origin);
    const distance=query?query(localRay,localMaximum,object.material,stats):mixedTriangles(object,subset,localRay,localMaximum,stats);
    nearest=Math.min(nearest,distance/localMaximum*nearest);
    }return nearest;
   };
  },
 };
}

const mixedA=new Vector3(),mixedB=new Vector3(),mixedC=new Vector3(),mixedHit=new Vector3();
function mixedTriangles(object,triangles,ray,maximum,stats){
 const geometry=object.geometry,index=geometry.index,draw=geometry.drawRange;
 for(const triangle of triangles){
  const offset=triangle*3;if(offset<draw.start||offset+3>draw.start+draw.count)continue;
  const material=Array.isArray(object.material)?object.material[geometry.groups.find(g=>offset>=g.start&&offset+3<=g.start+g.count)?.materialIndex]:object.material;
  if(!material||!material.depthWrite||!material.depthTest||material.transparent)continue;
  object.getVertexPosition(index?index.getX(offset):offset,mixedA);
  object.getVertexPosition(index?index.getX(offset+1):offset+1,mixedB);
  object.getVertexPosition(index?index.getX(offset+2):offset+2,mixedC);
  if(stats)stats.triangles++;
  const hit=material.side===BackSide?ray.intersectTriangle(mixedC,mixedB,mixedA,true,mixedHit):ray.intersectTriangle(mixedA,mixedB,mixedC,material.side!==DoubleSide,mixedHit);
  if(hit){const distance=hit.distanceTo(ray.origin);if(distance>1e-6)maximum=Math.min(maximum,distance);}
 }return maximum;
}
