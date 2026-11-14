export async function loadPreviewRenderer(viewer) {
  let config = {};
  try {
    const response = await fetch('./site-config.json', { cache: 'no-cache' });
    if (response.ok) config = await response.json();
  } catch {}
  if (viewer && config.resourceBaseURL) viewer.setAttribute('resource-base', config.resourceBaseURL);
  await import(config.rendererModuleURL || './eve-model-viewer.js');
  return config;
}
