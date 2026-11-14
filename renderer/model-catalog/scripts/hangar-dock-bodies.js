import {Box3,Vector3,Vector4} from 'three';

// EveChildMesh::UpdateVisibility and TriFrustum::GetPixelSizeAccrossEst.
// The authored body uses one rigid mesh area; all four copies share its geometry.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/TriFrustum.cpp#L268-L299
export function dockBodyDraws(bodies){
  const box=new Box3(),center=new Vector3(),size=new Vector3(),viewport=new Vector4();
  const entries=bodies.map(body=>{
    const meshes=[];
    body.traverse(mesh=>{
      if(!mesh.isMesh)return;
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      meshes.push(mesh);
    });
    return {body,meshes};
  });
  return function update(worldAt,inverse,camera,renderer,eye){
    if(!entries.length)return;
    const width=camera.viewport?.z??renderer.getCurrentViewport(viewport).z;
    const projection=width*camera.projectionMatrix.elements[0];
    for(const {body,meshes} of entries){
      const {visible,world}=worldAt(body.userData.eveDockParent);
      body.visible=visible;
      if(!visible)continue;
      body.matrix.copy(world).premultiply(inverse);
      body.updateMatrixWorld(true);
      for(const mesh of meshes){
        box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        const radius=box.getSize(size).length()/2;
        const distanceSq=box.getCenter(center).distanceToSquared(eye)-radius*radius;
        mesh.visible=distanceSq<=0||radius*projection/Math.sqrt(distanceSq)>=(body.userData.eveDockMinScreenSize??0);
      }
    }
  };
}
