// Keep the user's effects preference intact while preview suppresses rendering.
export function effectsEnabled(settings = {}) {
  return settings?.effects !== false && settings?.noColor !== true;
}

export const textureRoles = Object.freeze([
  'AlbedoMap', 'NormalMap', 'RoughnessMap', 'MaterialMap', 'PaintMaskMap',
  'GlowMap', 'DirtMap', 'DustNoiseMap', 'SailsDetailMap',
  'PatternMask1Map', 'PatternMask2Map',
]);

export function normalizeDisplaySettings(values = {}) {
  const antialiasMode=['auto','none','smaa','msaa2','msaa4','msaa8'].includes(values.antialiasMode)
    ? values.antialiasMode : values.antialias===false?'none':'auto';
  return {
    antialias: antialiasMode !== 'none',
    antialiasMode,
    occlusion: values.occlusion !== false,
    bloom: values.bloom !== false,
    depthOfField: values.depthOfField === true,
    effects: values.effects !== false,
    noColor: values.noColor === true,
    textures: Object.fromEntries(textureRoles.map(role => [role, values.textures?.[role] !== false])),
  };
}

export const performanceControls = Object.freeze({
  antialias: 'show-antialias', effects: 'show-effects',
  occlusion: 'show-occlusion', bloom: 'show-bloom',
  depthOfField: 'show-dof', noColor: 'no-color',
});

export function antialiasSettings(settings,budget) {
  const mode=normalizeDisplaySettings(settings).antialiasMode;
  return {msaa:mode==='auto'?budget.msaa:mode.startsWith('msaa')?Number(mode.slice(4)):0,
    smaa:mode==='auto'||mode==='smaa'};
}

// model-viewer-effects removes SKIP passes and applies MSAA to its composer.
// https://github.com/google/model-viewer/blob/a594fb9ed482ab56ad267648175c4ebe4af7387e/packages/model-viewer-effects/src/effects/mixins/blend-mode.ts#L67-L76
// https://github.com/google/model-viewer/blob/a594fb9ed482ab56ad267648175c4ebe4af7387e/packages/model-viewer-effects/src/effect-composer.ts#L252-L261
export function applyPostprocessingSettings(viewer) {
  const settings = normalizeDisplaySettings(viewer.displaySettings);
  const composer = viewer.querySelector('effect-composer');
  if (!composer) return;
  const aa=antialiasSettings(settings,viewer.postprocessingBudget);
  composer.setAttribute('msaa', String(aa.msaa));
  const ao=composer.querySelector('ssao-effect')?.effects?.[0];
  if(ao&&ao.resolution.scale!==viewer.postprocessingBudget.aoScale)ao.resolution.scale=viewer.postprocessingBudget.aoScale;
  // SKIP removes effects from the composer's passes, including their update
  // work and the normal pass used by SSAO. Opacity zero would still run them.
  for (const [tag, enabled] of [
    ['smaa-effect', aa.smaa], ['ssao-effect', settings.occlusion],
    ['bloom-effect', settings.bloom && viewer.renderSettings.bloom > 0],
    ['eve-depth-of-field', settings.depthOfField && viewer.renderSettings.depthOfField > 0],
  ]) composer.querySelector(tag)?.setAttribute('blend-mode', enabled ? 'default' : 'skip');
  composer.querySelector('bloom-effect')?.setAttribute('strength', String(viewer.renderSettings.bloom));
  const dof=composer.querySelector('eve-depth-of-field');
  if(dof?.effects?.[0])dof.effects[0].bokehScale=viewer.renderSettings.depthOfField*2;
  composer.queueRender();
}
