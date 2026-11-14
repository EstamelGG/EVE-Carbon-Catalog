import {
  AddEquation, CustomBlending, DoubleSide, Frustum, GLSL3, Matrix3, Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor,
  ShaderMaterial, Sphere, Vector2, Vector3, ZeroFactor,
} from 'three';
import {beforeSceneRender, createEffectResources} from './effect-resources.js';
import {createParticleFog,particleFogFragment} from './gpu-particle-fog.js';
import {particleVertex} from './particle-billboard.js';
import {particleGeometry} from './particle-geometry.js';
import {GpuParticleSlots} from './gpu-particle-slots.js';
import {gpuParticleSize, gpuParticleTint} from './gpu-particle-curves.js';

const gpuAtlasFragment = `
in vec2 gateUV;in vec4 gateTint;in float gateTile;out vec4 fragColor;
uniform sampler2D atlas;uniform float grid;
${particleFogFragment}
void main(){
  // AtlasMapSize.y counts columns in the 1024x128 system atlas.
  vec2 uv=vec2((gateTile+gateUV.x)/grid,gateUV.y);
  fragColor=texture(atlas,uv)*gateTint*particleTransmission();
}`;

export function gpuAtlasMaterial(resources, atlas, grid, fog) {
  // Quads Main overrides RM_ALPHA_ADDITIVE with ONE / INV_SRC_ALPHA.
  // The base state writes RGB only. Preserve target alpha by blending 0*src + 1*dst.
  fog ??= resources.own(createParticleFog());
  const material = resources.own(new ShaderMaterial({
    glslVersion:GLSL3, defines:{EVE_GPU_FOG:1}, vertexShader:particleVertex, fragmentShader:gpuAtlasFragment,
    uniforms:{...fog.uniforms,atlas:{value:atlas}, grid:{value:grid}},
    transparent:true, depthWrite:false, side:DoubleSide, forceSinglePass:true,
    blending:CustomBlending, blendSrc:OneFactor, blendDst:OneMinusSrcAlphaFactor, blendEquation:AddEquation,
    blendSrcAlpha:ZeroFactor, blendDstAlpha:OneFactor,
  }));
  material.userData.eveBloomEmission = true;
  return material;
}

const sceneBatches = new WeakMap();
const defaultSizes = [1, 1, 1];
const packedAttributes = ['particleCenter', 'particleSize', 'particleTint', 'particleAngle', 'particleTile', 'particleVelocity', 'particleStretch'];

function visibleInScene(root, scene) {
  for (let node = root; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === scene) return true;
  }
  return false;
}

class GpuParticleBatch {
  constructor(scene, first, fog) {
    this.scene = scene;
    this.emitters = new Set();
    this.queue = [];
    this.slots = [];
    this.scope = createEffectResources();
    this.velocity = new Vector3();
    this.capacity = 1;
    const material = gpuAtlasMaterial(this.scope, first.atlas, first.grid, fog);
    this.mesh = new Mesh(particleGeometry(this.scope.plane(), this.capacity), material);
    this.mesh.name = 'GPU particles';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  update(view, camera) {
    const queue = this.queue, point = view.sphere.center, eyeMatrix = camera.matrixWorldInverse.elements;
    let count = 0;
    // CCP Update.fx checks all six planes and the maximum authored radius,
    // including variance. Its depth denominator clamps to one native scene unit.
    // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/Managed/Space/SpecialFX/Particles/Gpu/Update.fx#L113-L173
    for (const source of this.emitters) {
      if (!source.visible || !visibleInScene(source.root, this.scene)) continue;
      const world = source.root.matrixWorld, unit = point.setFromMatrixColumn(world, 0).length();
      const sizes = source.emitter.sizes || defaultSizes;
      const maxRadius = Math.max(sizes[0], sizes[1], sizes[2]) * (1 + Math.abs(source.emitter.sizeVariance ?? 0)) * source.sizeScale * unit;
      view.sphere.radius = maxRadius;
      source.velocityTransform ??= new Matrix3();
      source.velocityTransform.setFromMatrix4(view.matrix.multiplyMatrices(view.sceneInverse, world));
      source.drawScale = source.sizeScale * unit / view.sceneScale;
      for (const particle of source.pool.items) {
        point.copy(particle.position).applyMatrix4(world);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
        if (!view.frustum.intersectsSphere(view.sphere)) continue;
        const depth = -(eyeMatrix[2]*point.x + eyeMatrix[6]*point.y + eyeMatrix[10]*point.z + eyeMatrix[14]);
        const screenSize = Math.fround(maxRadius / Math.max(unit, depth) * view.widthProjection);
        if (!(screenSize > 2)) continue;
        const entry = this.slots[count] ??= {center:new Vector3()};
        queue[count] = entry;
        entry.center.copy(point).applyMatrix4(view.sceneInverse);
        entry.source = source;
        entry.particle = particle;
        entry.depth = depth;
        count++;
      }
    }
    queue.length = count;
    this.mesh.visible = count > 0;
    if (count > this.capacity) {
      this.capacity = 2 ** Math.ceil(Math.log2(count));
      this.mesh.geometry.dispose();
      this.mesh.geometry = particleGeometry(this.scope.plane(), this.capacity);
    }
    const geometry = this.mesh.geometry;
    geometry.instanceCount = count;
    if (!count) return;
    queue.sort((a, b) => b.depth - a.depth);
    const a = geometry.attributes;
    for (let i = 0; i < count; i++) {
      const {source, particle, center} = queue[i], emitter = source.emitter;
      const age = particle.life > 0 ? particle.age / particle.life : 0;
      const radius = Math.max(0, particle.size * gpuParticleSize(emitter.sizes || defaultSizes, age, emitter.sizeVariance, particle.gpuSeed) * source.drawScale);
      a.particleCenter.setXYZ(i, center.x, center.y, center.z);
      a.particleSize.setXY(i, radius, radius);
      a.particleTint.setXYZW(i, ...gpuParticleTint(emitter, age));
      const signedMotion = emitter.velocityStretchRotation ?? 0;
      const velocity = this.velocity.copy(particle.velocity).applyMatrix3(source.velocityTransform);
      a.particleVelocity.setXYZ(i, velocity.x, velocity.y, velocity.z);
      a.particleStretch.setX(i, Math.max(0, -signedMotion));
      a.particleAngle.setX(i, particle.spin + Math.max(0, signedMotion) * particle.age + source.rotationOffset);
      a.particleTile.setX(i, emitter.textureIndex || 0);
      queue[i].source = null;
      queue[i].particle = null;
    }
    for (const name of packedAttributes) {
      const attr = a[name];
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  remove(source) {
    this.emitters.delete(source);
    this.queue.length = 0;
    const next = this.emitters.values().next().value;
    this.mesh.material.uniforms.atlas.value = next?.atlas ?? null;
    if (next) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.scope.dispose();
  }
}

export function installGpuParticleBatches(scene, sources, maxParticles) {
  if (!sources.length) return () => {};
  let state = sceneBatches.get(scene);
  if (!state) {
    const batches = new Map(),fog=createParticleFog();
    const slots = new GpuParticleSlots(maxParticles);
    const view = {sphere:new Sphere(), frustum:new Frustum(), matrix:new Matrix4(), sceneInverse:new Matrix4(), point:new Vector3()};
    const targetSize = new Vector2();
    const unsubscribe = beforeSceneRender(scene, (camera, renderer) => {
      slots.finishUpdate();
      fog.update(scene,camera);
      const target = renderer.getRenderTarget();
      const width = target ? target.width : renderer.getDrawingBufferSize(targetSize).x;
      view.widthProjection = camera.projectionMatrix.elements[0] * width;
      view.frustum.setFromProjectionMatrix(view.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        camera.coordinateSystem, camera.reversedDepth);
      view.sceneInverse.copy(scene.matrixWorld).invert();
      view.sceneScale = view.point.setFromMatrixColumn(scene.matrixWorld, 0).length() || 1;
      for (const batch of batches.values()) batch.update(view, camera);
    }, {last:true});
    state = {batches, slots, unsubscribe,fog};
    sceneBatches.set(scene, state);
  }
  const owners = sources.map(source => {
    source.pool.gpuSlots = state.slots;
    const key = JSON.stringify([source.atlasKey?.uuid ?? String(source.atlasKey), source.grid]);
    let batch = state.batches.get(key);
    if (!batch) {
      batch = new GpuParticleBatch(scene, source,state.fog);
      state.batches.set(key, batch);
    }
    batch.emitters.add(source);
    return {key, source, batch};
  });
  return () => {
    for (const {key, source, batch} of owners) {
      source.pool.releaseGpuSlots?.();
      source.pool.gpuSlots = null;
      batch.remove(source);
      if (!batch.emitters.size) state.batches.delete(key);
    }
    owners.length = 0;
    if (!state.batches.size && sceneBatches.get(scene) === state) {
      state.unsubscribe();
      state.fog.dispose();
      sceneBatches.delete(scene);
    }
  };
}
