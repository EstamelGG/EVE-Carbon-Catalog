// Asset selection follows DNA race. Presentation fits never choose assets.
export function selectIconScene(catalog, dna, profile = 'ship') {
  if (catalog?.version !== 2 || !Array.isArray(catalog.scenes)) throw Error('Invalid icon scene catalog');
  const requested = dna?.startsWith('graphic:') ? 'generic' : dna?.split(':')[2];
  if (!requested) throw Error('Missing DNA race for icon scene');
  const entry = catalog.scenes.find(scene => scene.id === requested) || catalog.scenes.find(scene => scene.id === 'generic');
  if (!entry) throw Error('Missing generic icon scene');
  const expected = `res:/dx9/scene/iconbackground/${entry.id}.black`;
  if (entry.sceneSource !== expected || entry.lightingSource !== expected || !entry.sceneSHA256)
    throw Error('Icon background and lighting must name the same source scene');
  const local = path => path?.replace(/^res:\//, 'res/');
  const sources = entry.sources, lighting = entry.lighting;
  if (!sources || !lighting || lighting.sunMode !== 'scene' || lighting.lights.length || lighting.rigTransforms.length)
    throw Error('Invalid icon scene lighting');
  if (sources.background !== entry.resource || local(sources.background) !== entry.url ||
      local(sources.reflection) !== lighting.environment.source.reflection ||
      local(sources.diffuse) !== lighting.environment.source.diffuse)
    throw Error('Icon textures do not match the selected source scene');
  const sampling = entry.iconSampling?.[profile];
  if (!sampling || sampling.version !== 1) throw Error('Missing explicit icon sampling profile');
  return {entry, provenance:{dna, requestedScene:requested, selectedScene:entry.id,
    usedGenericFallback:requested !== entry.id, sceneSource:expected, sceneSHA256:entry.sceneSHA256,
    sources, sampling, lighting}};
}
