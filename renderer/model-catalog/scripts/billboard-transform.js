import {Matrix4, Vector3} from 'three';

const position = new Vector3(), scale = new Vector3(), forward = new Vector3();
const right = new Vector3(), up = new Vector3(), basis = new Matrix4(), inverseScale = new Vector3();
const toEye = new Vector3(), cameraRight = new Vector3(), axis = new Vector3();

// Billboard2D keeps the origin and takes the length of each incoming axis.
export function applyBillboard2D(world, cameraRotation, attenuation = 1) {
  position.setFromMatrixPosition(world);
  scale.setFromMatrixScale(world).multiplyScalar(attenuation);
  return world.compose(position, cameraRotation, scale);
}

// Trinity EveChildModifierBillboard3D::ApplyTransform, default (fixed=false).
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/TransformModifiers/EveChildModifierTransformCommon.h#L11-L84
// Copyright CCP ehf., MIT terms in ../../docs/licenses/carbon-trinity-MIT.txt.
export function applyBillboard3D(world, eye, cameraRotation, fixed) {
  if (fixed) {
    if (Math.abs(world.determinant()) < 1e-18) return world;
    position.setFromMatrixPosition(world);
    scale.setFromMatrixScale(world);
    // The fixed branch keeps the authored orientation and uses world Y for up.
    // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/TransformModifiers/EveChildModifierBillboard3D.cpp#L19-L30
    forward.subVectors(eye, position).normalize();
    right.set(forward.z, 0, -forward.x).normalize();
    if (!right.lengthSq()) right.set(1, 0, 0);
    up.crossVectors(forward, right).normalize();
    inverseScale.set(scale.x && 1/scale.x, scale.y && 1/scale.y, scale.z && 1/scale.z);
    return world.scale(inverseScale).multiply(basis.makeBasis(right, up, forward)).scale(scale);
  }

  applyBillboard2D(world, cameraRotation);

  // DistanceBase divides the eye projection by each squared axis length.
  // The camera-right projection uses the same axes with their scale intact.
  toEye.subVectors(eye, position);
  cameraRight.set(1, 0, 0).applyQuaternion(cameraRotation);
  for (let i = 0; i < 3; i++) {
    axis.setFromMatrixColumn(world, i);
    const lengthSq = axis.lengthSq();
    forward.setComponent(i, lengthSq ? toEye.dot(axis) / lengthSq : 0);
    right.setComponent(i, cameraRight.dot(axis));
  }
  forward.normalize();
  up.crossVectors(forward, right).normalize();
  right.crossVectors(up, forward);
  return world.multiply(basis.makeBasis(right, up, forward));
}
