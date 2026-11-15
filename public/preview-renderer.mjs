import { savedModelIndex, defaultModelIndex } from './res-preference.mjs';

export async function previewConfig() {
  let config = {};
  try {
    const response = await fetch('./site-config.json', { cache: 'no-cache' });
    if (response.ok) config = await response.json();
  } catch {}
  return { ...config, modelIndex: savedModelIndex() || defaultModelIndex(config) };
}

export async function loadPreviewRenderer(viewer, config) {
  config ??= await previewConfig();
  viewer?.setAttribute('model-index', config.modelIndex);
  await import(config.rendererModuleURL || './eve-model-viewer.js');
  return config;
}
