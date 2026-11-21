import {Euler, Matrix4, Quaternion} from 'three';

// Convert the authored orientation to the rotation used for file-backed cubes.
// https://github.com/mrdoob/three.js/blob/1939c35f2d92a4c870568da011aab54dabdfdd30/src/renderers/webgl/WebGLBackground.js#L133-L150
export function fileCubeRotation(target, rotation) {
  const euler = new Euler().setFromQuaternion(new Quaternion(...rotation));
  euler.x = -euler.x;
  return target.setFromMatrix4(new Matrix4().makeRotationFromEuler(euler));
}

// Exterior controls zoom the model by changing its FOV. Retain the viewer's
// weaker wheel response for the distant background and its star layers.
const skyLens = `
  vec4 projectSky(vec3 viewPosition, float skyFocal) {
    vec4 clip = projectionMatrix * vec4(viewPosition, 1.0);
    float cameraFocal = projectionMatrix[1][1];
    float zoom = cameraFocal * tan(radians(30.0) * 0.5);
    float skyZoom = 1.0 + 0.15 * (zoom - 1.0) / (zoom + 1.0);
    clip.xy *= skyFocal * skyZoom / cameraFocal;
    return clip.xyww;
  }
`;

export const distantSkyProjection = `${skyLens}
  vec4 projectDistantSky(vec3 viewPosition) {
    return projectSky(viewPosition, 1.0 / tan(radians(30.0) * 0.5));
  }
`;

// Fitted to c05_cube.dds in the in-game Caldari station preview: 50.1 degrees
// vertically at 2508 x 1388. EveCamera clamps the horizontal FOV above 16:10.
export const catalogSkyProjection = `${skyLens}
  vec4 projectCatalogSky(vec3 viewPosition) {
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    float skyFocal = max(1.0, aspect / 1.6) / tan(radians(55.66) * 0.5);
    return projectSky(viewPosition, skyFocal);
  }
`;
