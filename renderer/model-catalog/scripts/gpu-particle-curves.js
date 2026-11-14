// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/GpuParticles.fxh#L49-L74
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2GpuParticleSystem.cpp#L59-L77
export function gpuParticleSize([start, control, end], age, variance = 0, seed = 0) {
  const remaining = 1 - age;
  const curve = start * remaining * remaining + 2 * control * age * remaining + end * age * age;
  return curve * (1 + variance * seed);
}

// The preview feeds the packed fractional midpoint to the public colour
// function. The shader include and the packing code are public separately.
export function gpuParticleTint(emitter, age) {
  const midpoint = emitter.colorMidpoint ?? 0.5;
  const exponent = Math.max(0.001, Math.min(0.99, 1 - midpoint - Math.floor(midpoint)));
  const t = Math.pow(age, Math.log(exponent) / Math.log(0.5));
  const offset = t <= 0.333 ? 0 : t <= 0.666 ? 1 : 2;
  const start = offset * 0.333;
  const width = offset === 2 ? 1 - start : 0.333;
  const blend = (t - start) / width;
  const a = emitter['color' + offset] ?? [0, 0, 0, 0];
  const b = emitter['color' + (offset + 1)] ?? [0, 0, 0, 0];
  return a.map((channel, i) => channel + (b[i] - channel) * blend);
}
