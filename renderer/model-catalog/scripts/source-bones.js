import { Matrix4 } from 'three';

// GLTFLoader sanitizes and uniquifies Object3D.name for animation bindings.
// Native palettes retain source names (e.g. head.M), so never compare them to
// the runtime name when the original glTF node identity is available.
export function sourceBoneName(bone, document) {
  const index = bone.userData?.associations?.nodes;
  return document?.nodes?.[index]?.name ?? bone.userData?.name ?? bone.name;
}

// Single-weight Three.SkinnedMesh.applyBoneTransform in the effect root's space.
// https://github.com/mrdoob/three.js/blob/r183/src/objects/SkinnedMesh.js
export function bindAttachmentBones(root, model, document, targets) {
  const palette = document?.extras?.ccpdec?.bonePalette;
  if (!palette || !targets.size) return;
  const byName = new Map();
  for (const [index, group] of targets) {
    if (palette[index] === undefined) continue;
    const groups = byName.get(palette[index]) || [];
    groups.push(group);
    byName.set(palette[index], groups);
  }
  const bindings = new Map();
  model.traverse(part => {
    if (!part.isSkinnedMesh) return;
    part.skeleton.bones.forEach((bone, index) => {
      const name = sourceBoneName(bone, document);
      if (byName.has(name) && !bindings.has(name)) bindings.set(name, {
        part, bone, inverse: part.skeleton.boneInverses[index], groups: byName.get(name),
      });
    });
  });
  if (!bindings.size) return;
  const bindToPart = new Map();
  const rootInverse = new Matrix4(), transform = new Matrix4();
  return apply => {
    // Appearance and subsystem loaders may register a scene callback before
    // mounting their group. Capture bind space only after it joins the hull.
    if (!bindToPart.size) {
      let hullTree = model, effectTree = root;
      while (hullTree.parent) hullTree = hullTree.parent;
      while (effectTree.parent) effectTree = effectTree.parent;
      if (hullTree !== effectTree) return;
      root.updateWorldMatrix(true, false);
    }
    rootInverse.copy(root.matrixWorld).invert();
    for (const {part, bone, inverse, groups} of bindings.values()) {
      if (!bindToPart.has(part)) {
        part.updateWorldMatrix(true, false);
        bindToPart.set(part, part.matrixWorld.clone().invert().multiply(root.matrixWorld));
      }
      transform.copy(rootInverse).multiply(part.matrixWorld).multiply(part.bindMatrixInverse)
        .multiply(bone.matrixWorld).multiply(inverse).multiply(part.bindMatrix).multiply(bindToPart.get(part));
      for (const group of groups) apply(group, transform);
    }
  };
}
