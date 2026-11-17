import {Box3, Matrix4, Vector3} from 'three';
const part=new Box3(), matrix=new Matrix4();
// A skinned point is a convex combination of its bone-transformed positions.
// Their union box conservatively encloses every normalized, non-negative blend.
const skinBounds = new WeakMap();
function boneBoxes(mesh) {
  if (skinBounds.has(mesh)) return skinBounds.get(mesh);
  const {position, skinIndex, skinWeight} = mesh.geometry.attributes;
  let boxes = [];
  if (!position || !skinIndex || !skinWeight || mesh.morphTargetInfluences?.length) boxes = null;
  else {
    const point = new Vector3(), local = new Vector3();
    for (let i = 0; i < position.count && boxes; i++) {
      point.fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix);
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        const weight = skinWeight.getComponent(i,j);
        if (!weight) continue;
        const bone = skinIndex.getComponent(i,j);
        if (!(weight > 0) || !mesh.skeleton.bones[bone]) { boxes=null; break; }
        (boxes[bone] ||= new Box3()).expandByPoint(local.copy(point).applyMatrix4(mesh.skeleton.boneInverses[bone]));
        sum += weight;
      }
      if (Math.abs(sum-1)>1e-6) boxes=null;
    }
  }
  skinBounds.set(mesh,boxes);
  return boxes;
}

// In mesh-local coordinates. A failed bound leaves the mesh uncullable.
export function skinnedPoseBounds(mesh, bounds) {
  const boxes=boneBoxes(mesh);
  if(!boxes)return false;
  bounds.makeEmpty();
  boxes.forEach((box,i)=>{
    if(!box || !mesh.skeleton.bones[i]) return;
    matrix.multiplyMatrices(mesh.bindMatrixInverse,mesh.skeleton.bones[i].matrixWorld);
    bounds.union(part.copy(box).applyMatrix4(matrix));
  });
  if(bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite)){
    bounds.makeEmpty();return false;
  }
  bounds.expandByScalar(1e-5*(1+Math.max(bounds.min.length(),bounds.max.length())));
  return true;
}
