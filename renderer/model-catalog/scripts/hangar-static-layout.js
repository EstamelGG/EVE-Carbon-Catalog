/** Cache only immutable glTF subtrees. The room and effect-owned dock
 * transforms are updated independently of the glTF animation mixer. */
export function cacheStaticLayout(root, animated, layoutNodes) {
  if (!layoutNodes) return () => {};
  const eligible = new Set();
  function classify(node) {
    let fixed = layoutNodes.has(node) && !animated.has(node.name) &&
      !animated.has(node.uuid) && !node.userData.eveDockParent &&
      !node.isBone && !node.isSkinnedMesh && !node.isLight && !node.isCamera;
    for (const child of node.children) if (!classify(child)) fixed = false;
    if (fixed) eligible.add(node);
    return fixed;
  }
  classify(root);
  const restore = [];
  for (const node of eligible) {
    if (eligible.has(node.parent)) continue;
    const update = node.updateMatrixWorld;
    const parentWorld = node.matrixWorld.clone();
    let valid = false;
    // A new child may be animated independently, so permanently retire this
    // cache if ownership of the subtree changes.
    function invalidate() { active = false; }
    let active = true;
    node.traverse(child => {
      child.addEventListener('childadded', invalidate);
      child.addEventListener('childremoved', invalidate);
      restore.push(() => {
        child.removeEventListener('childadded', invalidate);
        child.removeEventListener('childremoved', invalidate);
      });
    });
    node.updateMatrixWorld = function(force) {
      const parent = this.parent;
      if (active && valid && parent && parentWorld.equals(parent.matrixWorld)) return;
      update.call(this, force);
      valid = !!parent;
      if (parent) parentWorld.copy(parent.matrixWorld);
    };
    restore.push(() => { node.updateMatrixWorld = update; });
  }
  return () => { for (const release of restore) release(); };
}
