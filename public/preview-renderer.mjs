import { savedResBase, defaultResBase } from './res-preference.mjs';

export async function previewConfig() {
  let config = {};
  try {
    const response = await fetch('./site-config.json', { cache: 'no-cache' });
    if (response.ok) config = await response.json();
  } catch {}
  return { ...config, resBase: savedResBase() || defaultResBase(config) };
}

export async function loadPreviewRenderer(viewer, config) {
  config ??= await previewConfig();
  if (viewer) {
    viewer.setAttribute('res-base', config.resBase);
    if (config.resourceBaseURL) viewer.setAttribute('resource-base', config.resourceBaseURL);
  }
  await import(config.rendererModuleURL || './eve-model-viewer.js');
  return config;
}
