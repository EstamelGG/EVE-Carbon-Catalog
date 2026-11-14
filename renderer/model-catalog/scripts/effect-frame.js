// Three compares all 16 matrix entries for exact pose equality.
// https://github.com/mrdoob/three.js/blob/1939c35f2d92a4c870568da011aab54dabdfdd30/src/math/Matrix4.js#L1230-L1239
import {Matrix4} from 'three';

// AO, bloom and color passes can render the same scene several times. Only
// reuse CPU effect evaluation when frame, time and camera/root pose agree.
export function createEffectFrameGuard(){
  let frame=-1,time,lastCamera=null,lastWidth;
  const eye=new Matrix4(),projection=new Matrix4(),rootWorld=new Matrix4();
  return (scene,camera,root,elapsed,width)=>{
    if(frame===scene.renderCount&&time===elapsed&&lastCamera===camera&&lastWidth===width&&
      eye.equals(camera.matrixWorld)&&projection.equals(camera.projectionMatrix)&&rootWorld.equals(root.matrixWorld))return false;
    frame=scene.renderCount;time=elapsed;lastCamera=camera;lastWidth=width;
    eye.copy(camera.matrixWorld);projection.copy(camera.projectionMatrix);rootWorld.copy(root.matrixWorld);
    return true;
  };
}
