// Captured ship supplements have no curve tracks. Retain their sampled phase,
// but advance looping atlases using the effect's existing seconds-per-cycle.
export function attachmentAtlasTime(record, elapsed, enabled) {
  const atlas = record.parameters?.AtlasInfo;
  if (!enabled || record.shader !== 'motionvectorramp.fx' || !Array.isArray(atlas) ||
      !(atlas[0] * atlas[1] > 1) || !(atlas[2] > 0) || !(atlas[3] > 0)) return null;
  const sampled = record.parameters?.CurrentTime;
  const phase = Array.isArray(sampled) ? sampled[0] : sampled;
  return (Number.isFinite(phase) ? phase : 0) + Math.max(0, elapsed);
}
