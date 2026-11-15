import presets from './render-presets.json' with { type: 'json' };

export const renderDefaults = Object.freeze(presets.defaults);
const rules = presets.rules.map(({ dna, settings }) => ({
  pattern: new RegExp(dna, 'i'),
  settings,
}));

export function renderDefaultsForDNA(dna) {
  const result = { ...renderDefaults };
  if (typeof dna === 'string') {
    const value = dna.trim();
    for (const { pattern, settings } of rules) {
      if (pattern.test(value)) Object.assign(result, settings);
    }
  }
  return result;
}

export function switchRenderDefaults(values, previousDNA, nextDNA) {
  const settings = normalizeRenderSettings(values);
  const previous = renderDefaultsForDNA(previousDNA), next = renderDefaultsForDNA(nextDNA);
  // Preserve manual tuning within the same preset, and preserve unrelated
  // sliders across ships. Only changed defaults follow the new model's DNA.
  for (const key of Object.keys(renderDefaults)) {
    if (previous[key] !== next[key]) settings[key] = next[key];
  }
  return settings;
}

export function normalizeRenderSettings(values = {}) {
  return Object.fromEntries(Object.entries(renderDefaults).map(([key, fallback]) => {
    const value = Number(values[key] ?? fallback);
    const min = key === 'exposure' || key === 'roughness' ? 0.1 : 0;
    const max = key === 'dirt' ? 5 : 3;
    return [key, Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback];
  }));
}

