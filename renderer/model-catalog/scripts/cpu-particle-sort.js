import {Box3, Frustum, Matrix4, Vector3} from 'three';

// Tr2ParticleSystem::Update, UpdateViewDependentData and SortParticles.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2ParticleSystem.cpp#L1018-L1135
export class CpuParticleSort {
  constructor() {
    this.bounds = new Box3();
    this.center = new Vector3();
    this.eye = new Vector3();
    this.referenceEye = new Vector3();
    this.matrix = new Matrix4();
    this.frustum = new Frustum();
    this.keys = [];
    this.indices = [];
    this.reset();
  }

  reset() {
    this.allowed = true;
    this.period = 1;
    this.clock = 0;
    this.elapsedSinceTick = 0;
    this.count = -1;
    this.dirty = true;
    this.hasReference = false;
    this.order = null;
    this.revision = 0;
  }

  advance(dt, streamsChanged) {
    if (dt <= 0) return 0;
    this.elapsedSinceTick += dt;
    if (this.period > 1) {
      this.clock = (this.clock + 1) % this.period;
      if (this.clock !== 0) return 0;
    }
    // Native dt and thresholds are single precision. Preserve the strict boundaries.
    const interval = Math.fround(Math.min(this.elapsedSinceTick, 1 / 3));
    this.elapsedSinceTick = 0;
    if (interval > Math.fround(.035)) this.allowed = false;
    else if (interval < Math.fround(.02)) this.allowed = true;
    this.dirty ||= streamsChanged;
    return interval;
  }

  drawOrder(particles, world, camera) {
    if (!camera) {
      if (this.order) this.revision++;
      this.hasReference = false;
      this.order = null;
      return null;
    }
    this.dirty ||= this.count !== particles.length;
    if (this.dirty) {
      this.bounds.makeEmpty();
      for (const particle of particles) this.bounds.expandByPoint(particle.position);
      this.count = particles.length;
    }
    this.bounds.getCenter(this.center).applyMatrix4(world);
    const {min, max} = this.bounds;
    const radius = .5 * Math.max(max.x - min.x, max.y - min.y, max.z - min.z)
      * this.eye.setFromMatrixColumn(world, 0).length();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem, camera.reversedDepth);
    // TriFrustum::IsSphereVisible ignores the far plane by default (Three plane 4).
    const visible = this.frustum.planes.every((plane, i) => i === 4 || plane.distanceToPoint(this.center) >= -radius);
    this.period = visible ? 1 : 4;
    this.eye.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.matrix.copy(world).invert());
    if (!this.dirty && this.hasReference && this.eye.distanceToSquared(this.referenceEye) < .001) return this.order;
    this.dirty = false;
    this.hasReference = true;
    this.referenceEye.copy(this.eye);
    this.revision++;
    this.order = null;
    if (visible && this.allowed) {
      this.indices.length = particles.length;
      for (let i = 0; i < particles.length; i++) {
        this.keys[i] = particles[i].position.distanceToSquared(this.eye);
        this.indices[i] = i;
      }
      this.order = this.indices.sort((a, b) => this.keys[b] - this.keys[a]);
    }
    return this.order;
  }
}
