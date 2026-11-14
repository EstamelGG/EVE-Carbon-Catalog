/*! Beam rotation modes adapted from CCP Trinity, MIT. See docs/licenses/carbon-trinity-MIT.txt. */
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/EveChildInstanceMeshRenderer.cpp#L225-L323
import {Matrix3,Matrix4,Quaternion,Vector3} from 'three';

const up=new Vector3(0,1,0);

function rotationArc(from,to){
  const a=from.clone().normalize(),b=to.clone().normalize();
  const axis=a.clone().cross(b),cosine=a.dot(b);
  if(cosine<-.99999){
    if(axis.lengthSq()===0)axis.set(1,0,0);
    else axis.normalize();
    return new Quaternion(axis.x,axis.y,axis.z,0);
  }
  return new Quaternion(axis.x,axis.y,axis.z,cosine+1).normalize();
}

// EveChildInstanceMeshRenderer::UpdateGeometryResource. The incoming root
// transform is in native metres. Camera and local placement share that frame.
export function beamRotation(out,mode,placement,position,world,camera,offset){
  const ray=camera.clone().sub(position.clone().applyMatrix4(world));
  if(mode===1){
    ray.normalize();
    const q=new Quaternion().setFromRotationMatrix(world);
    // Direction of inverse(q) * up * q, up to a positive scalar which the
    // following cross products and arc normalization discard.
    const objDir=up.clone().applyQuaternion(q.normalize().conjugate());
    const right=up.clone().cross(objDir).normalize();
    const objUp=right.lengthSq() ? objDir.clone().cross(right) : new Vector3(0,0,-objDir.y);
    const halfRoll=Math.PI/2-Math.atan2(ray.x,ray.z)/2;
    out.copy(rotationArc(ray,up)).invert().multiply(rotationArc(up,objUp))
      .multiply(new Quaternion(0,0,Math.cos(halfRoll),Math.sin(halfRoll)));
  }else if(mode===2){
    const basis=world.clone().multiply(new Matrix4().makeRotationFromQuaternion(placement));
    ray.applyMatrix3(new Matrix3().setFromMatrix4(basis).transpose());
    out.copy(placement).multiply(new Quaternion().setFromAxisAngle(up,Math.atan2(ray.x,ray.z)));
  }else{
    const v=up.clone().applyQuaternion(placement).normalize().negate();
    if(v.z>=.99999)out.set(1,0,0,0);
    else {
      const half=Math.sqrt((1-v.z)/2);
      out.set(v.y/(2*half),-v.x/(2*half),0,half);
    }
  }
  return out.multiply(new Quaternion().fromArray(offset??[0,0,0,1]));
}
