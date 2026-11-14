// Apply native owner-DNA results to an isolated equipment document. Equipment
// texture coordinates, masks, geometry, animation and standalone previews stay authored.
export const fittingParameterNames = [1, 2, 3, 4].flatMap(i =>
  ['DiffuseColor', 'FresnelColor', 'Gloss', 'DustDiffuseColor'].map(suffix => `Mtl${i}${suffix}`),
).concat('GeneralGlowColor');

export function resolveFittingMaterial(appearance, dna) {
  if (!appearance) return null; // Published v2 catalogs predating material capture.
  if (appearance.version !== 1 || appearance.mode !== 'authored-overrides') throw Error('Unsupported fitting appearance version');
  const key = appearance.byDNA?.[dna], parameters = appearance.profiles?.[key];
  if (!key || !parameters) throw Error('Missing fitting material for ship DNA');
  for (const name of Object.keys(parameters)) {
    const value = parameters[name];
    if (!fittingParameterNames.includes(name) || !Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite))
      throw Error('Invalid fitting parameter: ' + name);
  }
  return {key, parameters};
}

export function applyFittingMaterial(document, profile, authored) {
  if (!profile) return document;
  for (const name of fittingParameterNames)
    if (!Array.isArray(authored?.[name]) || authored[name].length !== 4 || !authored[name].every(Number.isFinite))
      throw Error('Missing authored equipment parameter: ' + name);
  for (const definition of document.materials || []) {
    const native = definition.extras?.ccpdecNative;
    if (native?.profile !== 'quad-runtime-v1' || !/(?:^|\/)(?:skinned_)?quadv5\.fx$/i.test(native.effect || ''))
      throw Error('Unsupported fitted equipment material');
    native.parameters = {...native.parameters};
    for (const name of fittingParameterNames)
      native.parameters[name] = [...(profile.parameters[name] || authored[name])];
  }
  return document;
}
