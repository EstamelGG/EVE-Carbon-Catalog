// Auxiliary depth/normal/emission passes only swap materials. Their callers
// suppress scene animation hooks and reuse the main pass's prepared transforms.
// Do not walk/recompose the entire hangar again for each of these passes.
export function renderPreparedScene(renderer, scene, camera) {
  const automatic = scene.matrixWorldAutoUpdate;
  scene.matrixWorldAutoUpdate = false;
  try {
    return renderer.render(scene, camera);
  } finally {
    scene.matrixWorldAutoUpdate = automatic;
  }
}
