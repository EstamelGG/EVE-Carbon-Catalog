// Trinity supplies the inverse decal transform and the parent joint separately.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/EveSpaceObjectDecal.fxh#L9-L26
// The skin-space conversion below adapts Three's bind and inverse-bind transforms.
// https://github.com/mrdoob/three.js/blob/r183/src/objects/SkinnedMesh.js
import { Matrix4, Quaternion, Vector3 } from 'three';
import { gltfNodeMatrix } from './model-bounds.js';
import { sourceBoneName } from './source-bones.js';

// Some rigid hulls retain an unused, identity root joint in the source palette.
// glTF has no skinned mesh for that joint, so there is no Skeleton to look up.
function isStaticIdentityJoint(doc, name) {
  if (!name || doc?.extras?.ccpdec?.bonePalette?.length !== 1 || doc.animations?.length) return false;
  const nodes = doc.nodes || [];
  if (nodes.some(node => node.skin != null)) return false;
  const matches = nodes.flatMap((node, i) => node.name === name ? [i] : []);
  if (matches.length !== 1 || !doc.skins?.some(skin => skin.joints?.includes(matches[0]))) return false;
  const matrix = new Matrix4(), visited = new Set();
  let index = matches[0];
  while (index != null) {
    if (visited.has(index)) return false;
    visited.add(index);
    const node = nodes[index];
    const local = gltfNodeMatrix(node);
    matrix.premultiply(local);
    const parents = nodes.flatMap((parent, i) => parent.children?.includes(index) ? [i] : []);
    if (parents.length > 1) return false;
    index = parents[0];
  }
  return matrix.elements.every((value, i) => Math.abs(value - (i % 5 === 0 ? 1 : 0)) < 1e-6);
}

// Projected decals use one authored joint matrix for their entire index subset.
// Keep projection in bind space and move the mesh: both coverage and labels then
// follow the same bone, without applying the hull's vertex weights a second time.
export function decalBoneTransform(viewer, scene, root, index, owner) {
  if (!(index >= 0)) return null;
  const document = owner?.document ?? viewer.originalGltfJson;
  const name = document?.extras?.ccpdec?.bonePalette?.[index];
  let entry;
  (owner?.model ?? scene.model)?.traverse(object => {
    if (entry || !object.isSkinnedMesh) return;
    const i = object.skeleton.bones.findIndex(bone => sourceBoneName(bone, document) === name);
    if (i >= 0) entry = {mesh:object, bone:object.skeleton.bones[i], inverse:object.skeleton.boneInverses[i]};
  });
  if (!entry && isStaticIdentityJoint(document, name)) return null;
  if (!entry) throw new Error(`Missing projected decal bone ${index}: ${name ?? 'unknown'}`);
  let sourceToMesh;
  const inverseRoot = new Matrix4();
  return target => {
    // Render hooks also run while async appearance assembly is still loading.
    // A detached effects group has no meaningful transform relative to the hull.
    if (!sourceToMesh) {
      let parent = root;
      while (parent && parent !== scene) parent = parent.parent;
      if (!parent) return target.identity();
    }
    root.updateWorldMatrix(true, false);
    entry.mesh.updateWorldMatrix(true, false);
    entry.bone.updateWorldMatrix(true, false);
    sourceToMesh ??= new Matrix4().copy(entry.mesh.matrixWorld).invert().multiply(root.matrixWorld);
    inverseRoot.copy(root.matrixWorld).invert();
    target.copy(inverseRoot).multiply(entry.mesh.matrixWorld)
      .multiply(entry.mesh.bindMatrixInverse).multiply(entry.bone.matrixWorld)
      .multiply(entry.inverse).multiply(entry.mesh.bindMatrix).multiply(sourceToMesh);
  };
}

export const projectedDecalVertex = `
uniform mat4 decalProjection;
out vec2 projected;
void main(){
 projected=(decalProjection*vec4(position,1.0)).yz;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

export function inverseDecalProjection(record) {
  return new Matrix4().compose(new Vector3(...record.position),
    new Quaternion(...record.rotation), new Vector3(...record.scaling)).invert();
}
