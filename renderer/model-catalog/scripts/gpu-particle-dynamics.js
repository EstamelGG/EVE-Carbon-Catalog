import {Matrix3, Vector3} from 'three';

// Linear, wrapped SampleLevel(0) on the RGBA8 volume published by the builder.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/Managed/Space/SpecialFX/Particles/Gpu/Update.fx#L17-L84
export function sampleNoise({data, width, height, depth}, x, y, z, out) {
  x = (x - Math.floor(x)) * width - 0.5;
  y = (y - Math.floor(y)) * height - 0.5;
  z = (z - Math.floor(z)) * depth - 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  out.set(0, 0, 0);
  for (let dz = 0; dz < 2; dz++) {
    const plane = ((iz + dz + depth) % depth) * height;
    for (let dy = 0; dy < 2; dy++) {
      const row = (plane + (iy + dy + height) % height) * width;
      const yzWeight = (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz) / 255;
      for (let dx = 0; dx < 2; dx++) {
        const index = (row + (ix + dx + width) % width) * 4;
        const weight = yzWeight * (dx ? fx : 1 - fx);
        out.x += data[index] * weight;
        out.y += data[index + 1] * weight;
        out.z += data[index + 2] * weight;
      }
    }
  }
  return out;
}

// Tr2GpuParticleSystem.cpp packs frequency / 4096 and advances noise Z by 0.05/s.
// The viewer simulates in model-root units with a stationary origin.
export class GpuParticleDynamics {
  constructor() {
    this.phase = new Vector3();
    this.sample = new Vector3();
    this.target = new Vector3();
  }

  step(items, emitter, dt, time) {
    const amplitude = emitter.turbulenceAmplitude ?? 0;
    const frequency = (emitter.turbulenceFrequency ?? 1) / 4096;
    if (this.volume && amplitude) sampleNoise(this.volume, 0, 0, time * 0.05 / 32, this.phase);
    this.target.fromArray(emitter.attractorPosition ?? [0, 0, 0]);
    for (const particle of items) {
      particle.age += dt;
      if (particle.age >= particle.life) continue;
      const {position, velocity} = particle;
      velocity.y += (emitter.gravity ?? 0) * dt;
      if (amplitude && this.volume) {
        let x = position.x * frequency + this.phase.x;
        let y = position.y * frequency + this.phase.y;
        let z = position.z * frequency + this.phase.z;
        let weight = amplitude * dt;
        for (let octave = 0; octave < 3; octave++) {
          sampleNoise(this.volume, x, y, z, this.sample).addScalar(-0.5);
          velocity.addScaledVector(this.sample, weight);
          const nextX = 2 * z;
          z = 2 * x;
          x = nextX;
          y *= 2;
          weight *= 0.5;
        }
      }
      // A package without the volume cannot supply a spatial force field.
      // Keep gravity, drag and attraction active in these legacy scenes.
      if (emitter.attractorStrength) {
        this.sample.subVectors(this.target, position).normalize();
        velocity.addScaledVector(this.sample, emitter.attractorStrength * dt);
      }
      const drag = emitter.drag ?? 0;
      velocity.multiplyScalar(drag < 0 ? 1 + velocity.length() * drag * dt : 1 - drag * dt);
      position.addScaledVector(velocity, dt);
    }
  }
}

// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2GpuUniqueEmitter.cpp#L20-L52
// Birth and attractor positions include translation. Gravity stays on scene Y.
export function gpuEmitterInScene(emitter, matrix, scale) {
  const point = values => new Vector3().fromArray(values ?? [0, 0, 0]).applyMatrix4(matrix).toArray();
  // XMMatrixDecompose assigns a negative determinant to the largest axis.
  const reflectedAxis = emitter.scaledByParent && matrix.determinant()<0 ? Math.max(scale.x,scale.y,scale.z) : 0;
  const uniform = emitter.scaledByParent ? (scale.x + scale.y + scale.z - 2*reflectedAxis) / 3 : 1;
  return {
    ...emitter, parentSizeScale:uniform,
    position: point(emitter.position),
    direction: new Vector3().fromArray(emitter.direction ?? [0, 1, 0]).applyMatrix3(new Matrix3().setFromMatrix4(matrix)).toArray(),
    attractorPosition: point(emitter.attractorPosition),
    radius: uniform * (emitter.radius ?? 0),
    minSpeed: uniform * (emitter.minSpeed ?? 0),
    maxSpeed: uniform * (emitter.maxSpeed ?? 0),
    gravity: uniform * (emitter.gravity ?? 0),
    turbulenceAmplitude: uniform * (emitter.turbulenceAmplitude ?? 0),
    attractorStrength: uniform * (emitter.attractorStrength ?? 0),
  };
}
