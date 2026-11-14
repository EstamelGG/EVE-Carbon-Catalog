import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

export function gltfNodeMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3(...(node.translation || [0, 0, 0])),
    new Quaternion(...(node.rotation || [0, 0, 0, 1])),
    new Vector3(...(node.scale || [1, 1, 1])),
  );
}

// glTF accessor bounds are tiny metadata: no texture decode or GPU upload.
export function gltfDimensions(document) {
  const bounds=new Box3();
  function visit(index,parent){
    const node=document.nodes[index];
    const local = gltfNodeMatrix(node);
    const world=parent.clone().multiply(local);
    if(node.mesh!==undefined) for(const primitive of document.meshes[node.mesh].primitives){
      const accessor=document.accessors[primitive.attributes.POSITION];
      if(!accessor.min||!accessor.max)throw new Error('Position bounds missing');
      bounds.union(new Box3(new Vector3(...accessor.min),new Vector3(...accessor.max)).applyMatrix4(world));
    }
    for(const child of node.children||[])visit(child,world);
  }
  for(const root of document.scenes[document.scene||0].nodes)visit(root,new Matrix4());
  if(bounds.isEmpty())throw new Error('Empty model');
  return bounds.getSize(new Vector3());
}
