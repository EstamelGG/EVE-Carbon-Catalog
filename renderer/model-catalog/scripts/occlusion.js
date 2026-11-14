import { BackSide, DoubleSide, MeshBasicMaterial, MeshNormalMaterial, NoBlending } from 'three';
import { Selection } from 'postprocessing';
import { normalBufferShader } from './scene-buffers.js';

// Three tests material visibility per geometry group before applying scene.overrideMaterial.
// Reuse the source shader for cutouts so depth and normals discard the same fragments.
export const normalPassScenes = new WeakSet();

export function limitNormalsToDepthWriters(pass) {
  const previous = pass.selection;
  const render = pass.render;
  const selection = new Selection();
  const hidden = new MeshBasicMaterial({visible: false});
  const backNormals = new MeshNormalMaterial({side: BackSide, allowOverride: false});
  const doubleNormals = new MeshNormalMaterial({side: DoubleSide, allowOverride: false});
  const cutouts = new Map();
  const writesDepth = material => material?.visible && material.depthTest && material.depthWrite;

  function normalMaterial(source) {
    if (!writesDepth(source)) return hidden;
    if (!(source.alphaTest > 0 || source.alphaHash) ||
        !(source.isMeshStandardMaterial || source.isMeshBasicMaterial)) {
      if (source.side === BackSide) return backNormals;
      if (source.side === DoubleSide) return doubleNormals;
      return source;
    }
    const key = source.customProgramCacheKey();
    let entry = cutouts.get(source);
    if (!entry || entry.version !== source.version || entry.key !== key) {
      entry?.release();
      const material = source.clone();
      material.allowOverride = false;
      material.colorWrite = true;
      material.blending = NoBlending;
      material.toneMapped = false;
      material.onBeforeCompile = (shader, renderer) => {
        source.onBeforeCompile.call(material, shader, renderer);
        normalBufferShader(shader, source.isMeshStandardMaterial);
      };
      material.customProgramCacheKey = () => key + ':eve-cutout-normals';
      const release = () => {
        source.removeEventListener('dispose', release);
        cutouts.delete(source);
        material.dispose();
      };
      source.addEventListener('dispose', release);
      entry = {material, key, version: source.version, release};
      cutouts.set(source, entry);
    }
    const {material} = entry;
    material.opacity = source.opacity;
    material.alphaTest = source.alphaTest;
    material.alphaHash = source.alphaHash;
    material.side = source.side;
    material.map = source.map;
    material.alphaMap = source.alphaMap;
    return material;
  }

  function refresh(swaps) {
    const removed = new Set(selection);
    pass.scene.traverseVisible(object => {
      if (!object.isMesh) return;
      const original = object.material;
      const grouped = Array.isArray(original);
      if (!(grouped ? original.some(writesDepth) : writesDepth(original))) return;
      if (!selection.has(object)) selection.add(object);
      removed.delete(object);
      if (!swaps) return;
      const next = grouped ? original.map(normalMaterial) : normalMaterial(original);
      if (next !== original) {
        swaps.push([object, original]);
        object.material = next;
      }
    });
    for (const object of removed) selection.delete(object);
  }

  refresh();
  pass.selection = selection;
  const renderWithSelection = function (...args) {
    const swaps = [];
    const currentScene = this.scene;
    const nested = normalPassScenes.has(currentScene);
    normalPassScenes.add(currentScene);
    try {
      refresh(swaps);
      return render.apply(this, args);
    } finally {
      if (!nested) normalPassScenes.delete(currentScene);
      for (const [object, original] of swaps) object.material = original;
    }
  };
  pass.render = renderWithSelection;
  return () => {
    if (pass.render === renderWithSelection) pass.render = render;
    if (pass.selection === selection) pass.selection = previous;
    selection.clear();
    for (const entry of cutouts.values()) entry.release();
    hidden.dispose();
    backNormals.dispose();
    doubleNormals.dispose();
  };
}
