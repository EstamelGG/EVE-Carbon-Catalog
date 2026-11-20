import {Euler, Matrix4, Quaternion} from 'three';

// Convert the authored orientation to the rotation used for file-backed cubes.
// https://github.com/mrdoob/three.js/blob/1939c35f2d92a4c870568da011aab54dabdfdd30/src/renderers/webgl/WebGLBackground.js#L133-L150
export function fileCubeRotation(target, rotation) {
  const euler = new Euler().setFromQuaternion(new Quaternion(...rotation));
  euler.x = -euler.x;
  return target.setFromMatrix4(new Matrix4().makeRotationFromEuler(euler));
}

// The sky uses the scene lens. Callers rotate directions without translating
// them, so moving the eye cannot change the background's angular size.
export const distantSkyProjection = `
  vec4 projectDistantSky(vec3 viewPosition) {
    vec4 clip = projectionMatrix * vec4(viewPosition, 1.0);
    return clip.xyww;
  }
`;
