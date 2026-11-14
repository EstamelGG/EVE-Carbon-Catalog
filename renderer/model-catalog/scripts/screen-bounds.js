import {Box3, Matrix4, Vector3, Vector4} from 'three';

// Conservative screen bounds, including the perspective near-plane crossing.
export function createScreenBounds() {
  const clip=new Matrix4(),point=new Vector4(),box=new Box3(),lo=new Vector3(),hi=new Vector3();
  let width,height;
  return {
    begin(camera,w,h){clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);width=w;height=h;},
    project(bounds,out) {
      lo.copy(bounds.min);hi.copy(bounds.max);
      let left=width,right=0,bottom=height,top=0;
      for(let i=0;i<8;i++){
        point.set(i&1?hi.x:lo.x,i&2?hi.y:lo.y,i&4?hi.z:lo.z,1).applyMatrix4(clip);
        if(point.w<=0){out.set(0,0,width,height);return;}
        const x=(point.x/point.w+1)*width*.5,y=(point.y/point.w+1)*height*.5;
        left=Math.min(left,x);right=Math.max(right,x);bottom=Math.min(bottom,y);top=Math.max(top,y);
      }
      out.set(Math.max(0,Math.floor(left)-2),Math.max(0,Math.floor(bottom)-2),
        Math.min(width,Math.ceil(right)+2),Math.min(height,Math.ceil(top)+2));
    },
    objectBox(object){
      if(object.isSkinnedMesh)return null;
      const source=object.isInstancedMesh?object:object.geometry;
      if(!source.boundingBox)source.computeBoundingBox();
      return box.copy(source.boundingBox).applyMatrix4(object.matrixWorld);
    },
  };
}
