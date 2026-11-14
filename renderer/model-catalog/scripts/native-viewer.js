import { $scene, $renderer } from '@google/model-viewer/lib/model-viewer-base.js';
import { prepareNativeScene } from './native-preview-scope.js';

// Keep model-viewer's private symbols at the integration boundary. Material
// ownership and cleanup can be exercised independently of the browser element.
export async function prepareNativePreview(
  viewer,
  settings,
  modelUrl,
  typeID,
  dna = '',
  options = {},
) {
  if (!viewer[$scene].model || !viewer.isConnected) return { commit: () => () => {}, dispose() {} };
  return prepareNativeScene(viewer, {
    ...options,
    scene: viewer[$scene],
    anisotropy: Math.max(1, viewer[$renderer].threeRenderer.capabilities.getMaxAnisotropy()),
    settings,
    modelUrl,
    typeID,
    dna,
  });
}

export async function installNativePreview(...args) {
  return (await prepareNativePreview(...args)).commit();
}
