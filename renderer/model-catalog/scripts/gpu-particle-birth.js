import {Vector3} from 'three';

// Both the system update and the shared emitter cap one display-frame dispatch.
export const maxGpuFrameTime = 1 / 15;

// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2GpuSharedEmitter.cpp#L114-L234
// Position and velocity
// span the display frame; the previous direction belongs to the last dispatch.
export class GpuEmissionMotion {
  constructor() {
    this.previousPosition = new Vector3();
    this.position = new Vector3();
    this.previousVelocity = new Vector3();
    this.velocity = new Vector3();
    this.direction = new Vector3();
    this.previousDirection = new Vector3();
    this.reset();
  }

  reset() {
    this.started = false;
    this.dispatched = false;
  }

  frame(emitter, dt) {
    if (this.started && dt <= 0) return;
    this.previousPosition.copy(this.position);
    this.previousVelocity.copy(this.velocity);
    this.position.fromArray(emitter.position);
    this.direction.fromArray(emitter.direction);
    if (this.started && dt > 0) {
      this.velocity.subVectors(this.position, this.previousPosition).divideScalar(dt);
    } else {
      this.previousPosition.copy(this.position);
      this.previousVelocity.set(0, 0, 0);
      this.velocity.set(0, 0, 0);
    }
    if (!this.dispatched) this.previousDirection.copy(this.direction);
    this.started = true;
  }

  frameBirths(emitter, dt, emitCountFactor = 1) {
    const distance = this.position.distanceTo(this.previousPosition);
    if (distance > (emitter.maxDisplacement ?? 1000)) return null;
    const timeBirths = Math.min(dt, maxGpuFrameTime) * (emitter.rate ?? 0) * emitCountFactor;
    if (!(emitter.emissionDensity > 0)) return timeBirths;
    return timeBirths + Math.min(emitter.maxEmissionDensity ?? 10000, distance * emitter.emissionDensity);
  }

  finishDispatch() {
    this.previousDirection.copy(this.direction);
    this.dispatched = true;
  }
}

// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/Managed/Space/SpecialFX/Particles/Gpu/Emit.fx#L9-L30
// With the shader's reversed quaternion multiplication, rotating +Z gives
// (sin(phi) sin(theta), sin(phi) cos(theta), cos(phi)) in its local basis.
export function gpuParticleBirth(particle, emitter, random, motion, start = 0, end = 1) {
  const birth = start + (end - start) * random();
  const angle = emitter.angle ?? 0;
  const inner = emitter.innerAngle ?? 0;
  const phi = inner + ((angle >= Math.PI / 2 ? Math.PI : angle) - inner) * random();
  const theta = random() * 4 * Math.PI;
  const axis = new Vector3();
  if (motion) axis.lerpVectors(motion.previousDirection, motion.direction, birth);
  else axis.fromArray(emitter.direction ?? [0, 1, 0]);
  axis.normalize();
  const x = Math.abs(axis.x) > Math.abs(axis.y) ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const y = new Vector3().crossVectors(axis, x).normalize();
  x.crossVectors(axis, y);
  const direction = axis.multiplyScalar(Math.cos(phi))
    .addScaledVector(x, Math.sin(phi) * Math.sin(theta))
    .addScaledVector(y, Math.sin(phi) * Math.cos(theta));

  if (motion) particle.position.lerpVectors(motion.previousPosition, motion.position, birth);
  particle.position.addScaledVector(direction, emitter.radius ?? 0);
  const min = emitter.minSpeed ?? 0;
  particle.velocity.copy(direction).multiplyScalar(min + ((emitter.maxSpeed ?? 0) - min) * random());
  if (motion) {
    const inherited = emitter.inheritVelocity ?? 1;
    particle.velocity.addScaledVector(motion.previousVelocity, inherited * (1 - birth));
    particle.velocity.addScaledVector(motion.velocity, inherited * birth);
  }
}
