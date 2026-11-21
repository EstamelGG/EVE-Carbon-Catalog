import {Euler, Matrix4, Quaternion} from 'three';

// Convert the authored orientation to the rotation used for file-backed cubes.
// https://github.com/mrdoob/three.js/blob/1939c35f2d92a4c870568da011aab54dabdfdd30/src/renderers/webgl/WebGLBackground.js#L133-L150
export function fileCubeRotation(target, rotation) {
  const euler = new Euler().setFromQuaternion(new Quaternion(...rotation));
  euler.x = -euler.x;
  return target.setFromMatrix4(new Matrix4().makeRotationFromEuler(euler));
}

// The equipment preview has its own starfield lens.
export const distantSkyProjection = `
  vec4 projectDistantSky(vec3 viewPosition) {
    vec4 clip = projectionMatrix * vec4(viewPosition, 1.0);
    float cameraFocal = projectionMatrix[1][1];
    float zoom = cameraFocal * tan(radians(30.0) * 0.5);
    float skyZoom = 1.0 + 0.15 * (zoom - 1.0) / (zoom + 1.0);
    clip.xy *= skyZoom / zoom;
    return clip.xyww;
  }
`;

// Catalog nebulae use a 1 radian vertical lens at 16:10 and a fixed
// horizontal span on wider viewports. Only the aspect comes from the model camera.
export const catalogSkyProjection = `
  vec4 projectCatalogSky(vec3 viewPosition) {
    const float verticalFov = 1.0;
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    float focal = max(1.0, aspect / 1.6) / tan(verticalFov * 0.5);
    float w = -viewPosition.z;
    return vec4(viewPosition.xy * vec2(focal / aspect, focal), w, w);
  }
`;
