import {Euler, Matrix4, Quaternion} from 'three';

// Treat the authored orientation as Three's scene.backgroundRotation. For a
// file-backed cube Three flips lookup X and negates Euler X in the rotation.
// https://github.com/mrdoob/three.js/blob/1939c35f2d92a4c870568da011aab54dabdfdd30/src/renderers/webgl/WebGLBackground.js#L133-L150
export function fileCubeRotation(target, rotation) {
  const euler = new Euler().setFromQuaternion(new Quaternion(...rotation));
  euler.x = -euler.x;
  return target.setFromMatrix4(new Matrix4().makeRotationFromEuler(euler));
}

// Viewer presentation policy: keep camera rotation and viewport aspect, but
// allow only a small focal-length change for the distant photographic backdrop.
// projectionMatrix[1][1] is cot(vertical FOV / 2) for a perspective camera.
export const distantSkyProjection = `
  vec4 projectDistantSky(vec3 viewPosition) {
    vec4 clip = projectionMatrix * vec4(viewPosition, 1.0);
    float homeFocal = 1.0 / tan(radians(30.0) * 0.5);
    float zoom = projectionMatrix[1][1] / homeFocal;
    float skyZoom = 1.0 + 0.15 * (zoom - 1.0) / (zoom + 1.0);
    clip.xy *= skyZoom / zoom;
    return clip.xyww;
  }
`;
