/* The native Clear/Emit/Update passes share one dead list across the scene.
 * Only materialize slot IDs that have actually been used by the web simulation.
 * https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/Managed/Space/SpecialFX/Particles/Gpu/Emit.fx#L87-L130
 */
export const defaultMaxGpuParticles = 1024 * 1024;

export class GpuParticleSlots {
  constructor(capacity = defaultMaxGpuParticles) {
    this.unused = capacity;
    this.free = [];
    this.expired = [];
  }

  allocate() {
    if (this.free.length) return this.free.pop();
    return this.unused > 0 ? --this.unused : -1;
  }

  finishUpdate() {
    // Native Emit runs for every request before Update returns this frame's deaths.
    for (const slot of this.expired) this.free.push(slot);
    this.expired.length = 0;
  }
}
