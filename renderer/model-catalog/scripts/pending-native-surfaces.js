import { isGlassMaterial } from './glass-material.js';

// Portable glTF cannot express the native transmission/cutout/effect passes.
// Keep their fallback geometry out of early hull frames until it is replaced.
export function hidePendingNativeSurfaces(model, definitions) {
  const pending = new Set(definitions.filter(definition => {
    const native = definition.extras?.ccpdecNative;
    return native && (native.profile === 'fx-surface-v1' || native.clip || isGlassMaterial(native));
  }).map(definition => definition.name));
  const visibility = new Map();
  model.traverse(mesh => {
    if (!mesh.isMesh || !pending.has(mesh.material?.name)) return;
    visibility.set(mesh, mesh.visible);
    mesh.visible = false;
  });
  const reveal = mesh => {
    if (!visibility.has(mesh)) return;
    mesh.visible = visibility.get(mesh);
    visibility.delete(mesh);
  };
  return { reveal, dispose() { for (const mesh of visibility.keys()) reveal(mesh); } };
}
