import {Box3,Matrix4,Sphere,Spherical,Vector3} from 'three';

export function equipmentDistanceOrder(instances,camera){
 const cameraPosition=camera.getWorldPosition(new Vector3()),center=new Vector3(),bounds=new Box3();
 return instances.map(({model},index)=>{
  model.updateWorldMatrix(true,true);bounds.setFromObject(model,true);
  if(bounds.isEmpty())model.getWorldPosition(center);else bounds.getCenter(center);
  return {index,distance:center.distanceToSquared(cameraPosition)};
 }).sort((a,b)=>a.distance-b.distance||a.index-b.index).map(item=>item.index);
}

// Keep the first click's ordering while the camera moves between instances.
export function createEquipmentFocusCycle(){
 let current=null,order=[],cursor=0;
 return {
  next(instances,camera){
   if(current!==instances){current=instances;order=equipmentDistanceOrder(instances,camera);cursor=0;}
   if(!order.length)return -1;
   const index=order[cursor];cursor=(cursor+1)%order.length;return index;
  },
  reset(){current=null;order=[];cursor=0;},
 };
}

// camera-target is in ModelScene.target coordinates; orbit directions include
// turntable yaw. Mixing these spaces makes side/bottom mounts focus off-ship.
export function fittingFocusPose({scene,root,mount,model,orbit}) {
 scene.updateMatrixWorld(true);
 const matrix=new Matrix4().fromArray(mount.matrix);
 const target=new Vector3().setFromMatrixPosition(matrix);
 root.localToWorld(target);
 const hullRadius=scene.boundingSphere.radius;
 // Keep surrounding hull visible instead of zooming into the mount surface.
 const contextRadius=hullRadius*1.5;
 let radius=contextRadius;
 if(model){
  const sphere=new Box3().setFromObject(model,true).getBoundingSphere(new Sphere());
  if(!sphere.isEmpty()){target.copy(sphere.center);radius=Math.max(contextRadius,sphere.radius*5);}
 }
 scene.target.worldToLocal(target);
 const toScene=new Matrix4().copy(scene.matrixWorld).invert();
 const direction=axis=>axis.transformDirection(matrix).transformDirection(root.matrixWorld).transformDirection(toScene);
 const normal=direction(new Vector3(0,1,0));
 // A normal above/below the hull points at an orbit pole. Its azimuth is
 // undefined (or dominated by rounding), so use the mount's forward axis.
 // Keep this independent of the current view so repeated clicks stay put.
 const heading=normal.x*normal.x+normal.z*normal.z<1e-6
  ?direction(new Vector3(0,0,1)):normal;
 const spherical=new Spherical().setFromVector3(normal);
 const azimuth=Math.atan2(heading.x,heading.z);
 const theta=orbit.theta+Math.atan2(Math.sin(azimuth-orbit.theta),Math.cos(azimuth-orbit.theta));
 // View top/bottom equipment obliquely, at most 45 degrees above/below
 // the horizon, retaining the outward-facing side and some hull context.
 return {target,orbit:{theta,phi:Math.max(Math.PI/4,Math.min(Math.PI*3/4,spherical.phi)),radius:Math.max(.01,radius)}};
}
