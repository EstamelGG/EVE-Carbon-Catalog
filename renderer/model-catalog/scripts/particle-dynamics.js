import { Vector3 } from 'three';
import { noise } from './particle-noise.js';

// CCP Trinity (MIT), Tr2ParticleSystem::UpdateSimulation and the GetForce
// methods in Particle/. The web preview keeps elapsed age in seconds.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2ParticleSystem.cpp#L555-L718
function addTurbulence(total, force, position, time) {
  const frequency = force.frequency ?? [1, 1, 1, 1];
  const point = [...position.toArray(), time].map((value, i) => value * frequency[i]);
  const sample = [0, 0, 0, 0];
  let weight = 0.5;
  let sum = 0;
  for (let i = 0; i < force.noiseLevel; i++) {
    noise.turbulence(sample, ...point, weight);
    sum += weight;
    for (let axis = 0; axis < 4; axis++) point[axis] /= force.noiseRatio;
    weight *= force.noiseRatio;
  }
  const amplitude = force.amplitude ?? [1, 1, 1];
  total.x += sample[0] * amplitude[0] * sum;
  total.y += sample[1] * amplitude[1] * sum;
  total.z += sample[2] * amplitude[2] * sum;
}

export class ParticleDynamics {
  constructor(system = {}) {
    this.system = system;
    // Older minimal records omit the declaration and use the preview defaults.
    const has = kind => system.elements?.some(e => e.elementType === kind) ?? true;
    this.hasLifetime = has(0);
    this.hasMotion = has(1) && has(2);
    this.hasMass = has(3);
    this.force = new Vector3();
    this.direction = new Vector3();
    this.time = 0;
  }

  update(items, dt) {
    const moving = this.hasMotion && this.system.updateSimulation !== false;
    const aging = this.hasLifetime && this.system.applyAging !== false;
    if (moving) this.time += dt;
    // Trinity fills an expired slot with the last live slot and visits it again.
    // The unsorted vertex upload exposes this storage order when sorting is disabled.
    if (aging) {
      for (let i = 0; i < items.length;) {
        const particle = items[i];
        particle.age += dt;
        if (particle.age >= particle.life) {
          const last = items.pop();
          if (i < items.length) items[i] = last;
        } else i++;
      }
    }
    let live = 0;
    for (const particle of items) {
      if (moving) {
        if (this.system.applyForce !== false && this.system.forces?.length) {
          this.accelerate(particle, dt);
        }
        particle.position.addScaledVector(particle.velocity, dt);
      }
      const {x, y, z} = particle.position;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) items[live++] = particle;
    }
    items.length = live;
  }

  accelerate({position, velocity, mass}, dt) {
    const particleMass = this.hasMass ? mass : 1;
    const total = this.force.set(0, 0, 0);
    for (const force of this.system.forces) {
      if (force.type.endsWith('FluidDragForce')) {
        // GetForce tests reversal using dt * mass. UpdateSimulation divides
        // the resulting force by mass separately when integrating velocity.
        // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2ParticleFluidDragForce.cpp#L26-L34
        const drag = force.drag * velocity.length();
        const step = dt * particleMass;
        total.addScaledVector(velocity, drag * step > 1 ? -1 / step : -drag);
      } else if (force.type.endsWith('DragForce')) {
        total.addScaledVector(velocity, -force.drag);
      } else if (force.type.endsWith('DirectForce')) {
        total.add(this.direction.fromArray(force.force));
      } else if (force.type.endsWith('AttractorForce')) {
        const direction = this.direction.fromArray(force.position).sub(position).normalize();
        total.addScaledVector(direction, force.magnitude);
      } else if (force.type.endsWith('TurbulenceForce')) {
        addTurbulence(total, force, position, this.time);
      }
    }
    velocity.addScaledVector(total, dt / particleMass);
  }
}
