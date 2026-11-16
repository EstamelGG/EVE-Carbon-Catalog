export const renderDefaults = Object.freeze({
  exposure: 0.7,
  reflection: 0.7,
  bloom: 0.2,
  sun: 1,
  fill: 1,
  f0: 1,
  roughness: 1,
  dirt: 1,
  saturation: 0,
  contrast: 0,
  occlusionStrength: 4,
  occlusionRadius: 0.16,
  depthOfField: 1,
});

const rules = [
  { pattern: /^[^:]*:[^:]*:(sansha|triglavian)(:|$)/i, settings: { f0: 2 } },
  { pattern: /^[^:]*:[^:]*:concord(:|$)/i, settings: { fill: 0.3 } },
  { pattern: /^[^:]*:[^:]*:soe(:|$)/i, settings: { fill: 0.5 } },
  { pattern: /^[^:]+:viziam:/i, settings: { sun: 0.7, fill: 0.5 } },
];

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
    const min = ['saturation', 'contrast'].includes(key) ? -1 : key === 'occlusionRadius' ? 0.025 : key === 'exposure' || key === 'roughness' ? 0.1 : 0;
    const max = ['saturation', 'contrast'].includes(key) ? 1 : key === 'occlusionRadius' ? 0.3 : key === 'occlusionStrength' ? 10 : key === 'dirt' ? 5 : 3;
    return [key, Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback];
  }));
}

