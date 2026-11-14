import {Box3,MathUtils,Matrix4,Vector3} from 'three';
import {beforeSceneRender} from './effect-resources.js';
import {createHangarObstacles} from './hangar-obstacles.js';

// Three's default perspective lens is the viewer's base lens for a room.
// EveCamera::CalculateProjectionMatrix caps horizontal span at aspect 1.6.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/EveCamera.cpp#L602-L635
const baseHalfAngle = MathUtils.degToRad(50 / 2);
const validAspect = aspect => Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
export function hangarFieldOfView(aspect) {
 const ratio = validAspect(aspect);
 return MathUtils.radToDeg(2 * Math.atan(Math.tan(baseHalfAngle) * Math.min(1, 1.6 / ratio)));
}

export function hangarCameraRange(room, radius, aspect, nearClip) {
 // Fit the silhouette of a sphere about the docked hull center. At distance d
 // its apparent half-angle is asin(radius/d). Use three fifths of the shorter viewport
 // dimension for the default ship silhouette and a fifth for the room overview.
 const ratio = validAspect(aspect);
 const tangent = Math.tan(MathUtils.degToRad(hangarFieldOfView(ratio) / 2)) * Math.min(1, ratio);
 const distanceFor = fraction => radius * Math.hypot(1, 1 / (fraction * tangent));
 const minimum = radius + nearClip;
 const locator = room.locatorSets?.find(set => set.name === 'maxCameraDistance')?.locators?.[0]?.[0];
 const authoredLimit = locator && Math.hypot(...locator);
 const maximum = Math.max(minimum, authoredLimit || distanceFor(.2));
 return {minimum, maximum, distance: MathUtils.clamp(distanceFor(.6), minimum, maximum)};
}

export function createHangarCamera(viewer,scene,controls){
 let saved=null;
 let obstacles=null,obstacleRoot=null,safeRadius=null,lastFrame=-1,lastTime=0;
 const direction=new Vector3(),origin=new Vector3(),desired=new Vector3(),right=new Vector3(),up=new Vector3();
 const corners=Array.from({length:4},()=>new Vector3());
 const sightBox=new Box3(),farCorner=new Vector3();
 const lastDesired=new Vector3(Infinity,0,0),lastRoom=new Matrix4();let limit=Infinity,lastLens='';
 const stop=beforeSceneRender(scene,camera=>{
  if(!saved||!obstacles||!controls.spherical||!camera?.isPerspectiveCamera)return;
  desired.setFromSpherical(controls.spherical);
  const radius=desired.length();if(radius<=0)return;
  // Orbit is centered at the scene origin; panning translates the scene target.
  // Keep the requested orbit intact so turning away from a wall restores zoom.
  const lens=[camera.near,camera.fov,camera.aspect].join(':');
  const orbitChanged=!desired.equals(lastDesired)||!lastRoom.equals(obstacleRoot.matrixWorld)||lastLens!==lens;
  const snapshot=orbitChanged||lastFrame!==scene.renderCount?obstacles.prepare(sightBox):null;
  if(snapshot&&(orbitChanged||snapshot.changed)){
   lastLens=lens;
   lastDesired.copy(desired);lastRoom.copy(obstacleRoot.matrixWorld);
   direction.copy(desired).normalize();origin.set(0,0,0);
   const clearance=camera.near;
   sightBox.setFromPoints([origin,desired]);
   // Guard the near-plane corners too, so a wall cannot clip a screen edge.
   const height=camera.near*Math.tan(camera.fov*Math.PI/360),width=height*camera.aspect;
   right.setFromMatrixColumn(camera.matrixWorld,0);up.setFromMatrixColumn(camera.matrixWorld,1);
   for(let i=0;i<4;i++){
    const offset=corners[i].copy(right).multiplyScalar(i<2?-width:width).addScaledVector(up,i%2?height:-height);
    sightBox.expandByPoint(offset);sightBox.expandByPoint(farCorner.copy(offset).add(desired));
   }
   limit=radius;
   if(snapshot.intersectsRegion(sightBox)){
    limit=snapshot.distance(origin,direction,radius,clearance);
    for(const offset of corners)limit=Math.min(limit,snapshot.distance(offset,direction,radius,clearance));
   }
  }
  if(lastFrame!==scene.renderCount){
   const now=performance.now(),elapsed=Math.max(0,now-lastTime);lastTime=now;lastFrame=scene.renderCount;
   // A newly reached wall takes effect immediately. On release follow the
   // viewer's configured camera decay, snapping once the remaining distance
   // is below half a vertical pixel at the requested distance.
   const decay=viewer.interpolationDecay;
   const halfPixel=radius*Math.tan(MathUtils.degToRad(camera.fov/2))/Math.max(1,scene.height);
   if(safeRadius===null||limit<=safeRadius||!(decay>0))safeRadius=limit;
   else safeRadius=MathUtils.lerp(limit,safeRadius,Math.exp(-elapsed/decay));
   if(limit-safeRadius>halfPixel)scene.queueRender();
   else safeRadius=limit;
  }
  camera.position.copy(direction).multiplyScalar(Math.max(camera.near,safeRadius));camera.updateMatrixWorld(true);
 },{first:true});
 return {
  setObstacles(value){obstacleRoot=value;obstacles=value?createHangarObstacles(value):null;safeRadius=null;lastFrame=-1;lastDesired.set(Infinity,0,0);
   if(!value&&controls.spherical){scene.getCamera().position.setFromSpherical(controls.spherical);scene.getCamera().updateMatrixWorld(true);}},
  configure(range,scale,{preserveView=false,fieldOfView}={}){
   if(!saved)saved={minimumRadius:controls.options.minimumRadius,maximumRadius:controls.options.maximumRadius,
    fov:controls.getFieldOfView()};
   const radii=preserveView?[controls.goalSpherical?.radius,viewer.getCameraOrbit?.().radius]
    .filter(r=>Number.isFinite(r)&&r>0):[];
   // Include both ends of an in-flight camera move, so applying the new
   // background's limits cannot silently reframe an already zoomed view.
   controls.applyOptions({minimumRadius:Math.min(range.minimum*scale,...radii),
    maximumRadius:Math.max(range.maximum*scale,...radii)});
   if(fieldOfView!==undefined||!preserveView)controls.setFieldOfView(fieldOfView??hangarFieldOfView(scene.aspect));
  },
  restore(){this.setObstacles(null);if(!saved)return;const {fov,...options}=saved;saved=null;
   controls.applyOptions(options);controls.setFieldOfView(fov);},
  dispose(){this.restore();stop();},
 };
}
