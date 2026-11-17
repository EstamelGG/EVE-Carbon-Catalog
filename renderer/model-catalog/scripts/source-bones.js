import { Matrix4 } from 'three';

// GLTFLoader sanitizes and uniquifies Object3D.name for animation bindings.
// Native palettes retain source names (e.g. head.M), so never compare them to
// the runtime name when the original glTF node identity is available.
export function sourceBoneName(bone, document) {
  const index = bone.userData?.associations?.nodes;
  return document?.nodes?.[index]?.name ?? bone.userData?.name ?? bone.name;
}

// Trinity's DetermineLocatorType gives named skeleton joints priority over
// authored SOF transforms. Resolve those joints into the hull root's space so
// grouping sees the physical mounts rather than duplicate SOF fallback data.
export function resolveBoneLocators(locators, model, document) {
  if (!Array.isArray(locators) || !locators.length || !model) return locators;
  const bones = new Map();
  model.traverse(part => {
    if (!part.isSkinnedMesh) return;
    part.skeleton.bones.forEach(bone => {
      const name = sourceBoneName(bone, document)?.toLowerCase();
      if (name && !bones.has(name)) bones.set(name, bone);
    });
  });
  if (!bones.size) return locators;
  model.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(model.matrixWorld).invert(), transform = new Matrix4();
  return locators.map(locator => {
    const name = typeof locator?.name === 'string' ? locator.name.toLowerCase() : '';
    const bone = bones.get(name);
    if (!bone) return locator;
    return {
      ...locator,
      transform: transform.copy(inverse).multiply(bone.matrixWorld).elements.slice(),
    };
  });
}

// Single-weight Three.SkinnedMesh.applyBoneTransform in the effect root's space.
// https://github.com/mrdoob/three.js/blob/r183/src/objects/SkinnedMesh.js
export function bindAttachmentBones(root, model, document, targets) {
  const palette = document?.extras?.ccpdec?.bonePalette;
  if (!targets?.size) return;
  const byName = new Map();
  for (const [key, group] of targets) {
    const name = typeof key === 'number' ? palette?.[key] : key;
    if (name === undefined || name === null) continue;
    const groups = byName.get(name.toLowerCase()) || [];
    groups.push(group);
    byName.set(name.toLowerCase(), groups);
  }
  const bindings = new Map();
  model.traverse(part => {
    if (!part.isSkinnedMesh) return;
    part.skeleton.bones.forEach((bone, index) => {
      const name = sourceBoneName(bone, document)?.toLowerCase();
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
