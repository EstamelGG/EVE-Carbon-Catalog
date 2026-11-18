import { DoubleSide, GLSL3, Mesh, ShaderMaterial, Vector3 } from 'three';
import { beforeSceneRender } from './effect-resources.js';
import { decalBoneTransform, inverseDecalProjection } from './decal-projection.js';

// decalholev5.fx from CarbonEngineJS tools-blender (d5b57ec):
// the interior is sampled by tracing the view ray through a unit sphere in
// decal space, then reading the exit direction from the cube map's ALPHA.
// https://github.com/carbonenginejs/tools-blender/blob/d5b57ec375c7886e9b5ecaeda6f36e6aa88ed790/addons/carbon_eve_resources/quad/reference.py
export function holeInteriorDirection(point, view) {
  const length = Math.hypot(view[0], view[1], view[2]);
  if (!length) return null;
  const direction = [view[0] / length, view[1] / length, view[2] / length];
  const along = point[0] * direction[0] + point[1] * direction[1] + point[2] * direction[2];
  const discriminant = along * along -
    (point[0] * point[0] + point[1] * point[1] + point[2] * point[2]) + 1;
  if (discriminant < 0) return null;
  const distance = -along + Math.sqrt(discriminant);
  const hit = [
    point[0] + distance * direction[0],
    point[1] + distance * direction[1],
    point[2] + distance * direction[2],
  ];
  const size = Math.hypot(hit[0], hit[1], hit[2]);
  return size ? hit.map(value => value / size) : null;
}

const holeVertex = `
uniform mat4 decalProjection;
out vec3 decalPosition;
out vec3 worldPosition;

void main() {
  vec4 local = vec4(position, 1.0);
  decalPosition = (decalProjection * local).xyz;
  worldPosition = (modelMatrix * local).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * local;
}
`;

const holeFragment = `
uniform sampler2D transparencyMap, holeMap;
uniform samplerCube insideCubeMap;
uniform vec3 glowColor;
uniform mat4 decalProjection;
in vec3 decalPosition;
in vec3 worldPosition;
out vec4 fragColor;

void main() {
  if (max(abs(decalPosition.x), abs(decalPosition.y)) > 1.0) discard;
  vec2 surfaceUV = decalPosition.xy * 0.5 + 0.5;
  vec3 view = mat3(decalProjection) * (worldPosition - cameraPosition);
  float lengthView = length(view);
  if (lengthView <= 0.0) discard;
  view /= lengthView;
  float along = dot(decalPosition, view);
  float discriminant = along * along - dot(decalPosition, decalPosition) + 1.0;
  if (discriminant < 0.0) discard;
  float distance = -along + sqrt(discriminant);
  vec3 exitDirection = normalize(decalPosition + distance * view);
  float interior = texture(insideCubeMap, exitDirection).a;
  vec4 hole = texture(holeMap, surfaceUV);
  float value = mix(hole.r, interior, hole.a);
  float alpha = texture(transparencyMap, surfaceUV).a;
  if (alpha <= 0.0) discard;
  fragColor = vec4(glowColor * value, alpha);
}
`;

export async function installHoleDecals(viewer, scene, root, records, resources, owner) {
  const meshes = [], bones = [];
  let unsubscribe;
  const dispose = () => {
    unsubscribe?.();
    for (const mesh of meshes) mesh.removeFromParent();
  };
  try {
    for (const record of records) {
      const updateBone = decalBoneTransform(viewer, scene, root, record.parentBoneIndex, owner);
      const [transparency, hole, interior] = await Promise.all([
        resources.texture(record.textures.DecalTransparencyMap),
        resources.texture(record.textures.DecalHoleMap),
        resources.texture(record.textures.DecalInsideCubeMap),
      ]);
      const material = resources.own(new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: holeVertex,
        fragmentShader: holeFragment,
        uniforms: {
          decalProjection: { value: inverseDecalProjection(record) },
          transparencyMap: { value: transparency },
          holeMap: { value: hole },
          insideCubeMap: { value: interior },
          glowColor: { value: new Vector3().fromArray(record.parameters.DecalGlowColor ?? [1, 1, 1]) },
        },
        transparent: true, depthWrite: false, side: DoubleSide,
      }));
      material.polygonOffset = true;
      material.polygonOffsetFactor = material.polygonOffsetUnits = -1;
      const mesh = new Mesh(resources.geometry(record.geometry), material);
      mesh.name = 'EVE hull breach decal';
      if (updateBone) {
        mesh.matrixAutoUpdate = mesh.frustumCulled = false;
        bones.push({ mesh, updateBone });
      }
      root.add(mesh);
      meshes.push(mesh);
    }
    if (bones.length) unsubscribe = beforeSceneRender(scene, () => {
      for (const { mesh, updateBone } of bones) {
        updateBone(mesh.matrix);
        mesh.updateWorldMatrix(false, false);
      }
    });
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
