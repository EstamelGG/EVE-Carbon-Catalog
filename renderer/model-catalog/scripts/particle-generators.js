import {MathUtils, Quaternion, Vector3} from 'three';

// Public Trinity generator equations and their CarbonEngineJS counterparts.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2SphereShapeAttributeGenerator.cpp#L72-L132
// https://github.com/carbonenginejs/runtime/blob/d605cf6281ca9e1bcbe5195f83a16378d8812947/src/trinity/particle/attribute/Tr2RandomIntegerAttributeGenerator.js
// Preview replay uses the pool's seeded stream. Reserve one sample per stored
// range lane, including padding, so existing catalog scenes keep their sequence.
function fillRange(particle, generator, pool, integer) {
  const values = generator.minRange.map((min, lane) => {
    const sampled = pool.range(min, generator.maxRange[lane]);
    return integer ? Math.floor(sampled + 0.5) : sampled;
  });
  const [first, second] = values;
  switch (generator.elementType) {
    case 0:
      particle.life = second ?? first;
      particle.age = first * particle.life;
      break;
    case 1: particle.position.fromArray(values); break;
    case 2: particle.velocity.fromArray(values); break;
    case 3: particle.mass = first; break;
    case 4:
      // Both "rotation" and "spin" carry the same 0..360 initial-angle range
      // on authored billboard streams. The preview billboard consumes radians.
      if (pool.rotationAttribute && generator.customName === pool.rotationAttribute) {
        particle.spin = MathUtils.degToRad(first);
        break;
      }
      if (pool.atlasAttribute && generator.customName === pool.atlasAttribute) {
        particle.atlas = first;
        break;
      }
      switch (generator.customName) {
        case 'size':
        case 'sizeDynamic':
          particle.size = first;
          particle.endSize = generator.dimension === 1 ? first : second ?? first;
          break;
        case 'rotation': if (!pool.rotationAttribute) particle.spin = first; break;
        case 'rotationVelocity':
        case 'spinVel':
          if(!pool.rotationRateAttribute || generator.customName===pool.rotationRateAttribute)particle.spinVelocity=first;
          break;
        case 'spin': if (!pool.rotationAttribute) particle.spin = MathUtils.degToRad(first); break;
        case 'atlasID': particle.atlas = first; break;
        case 'color': particle.color = values.slice(0, 4); break;
        case 'Offset': particle.offset = values.slice(0, 4); break;
      }
  }
}

function fillSphere(particle, generator, pool) {
  const azimuth = MathUtils.degToRad(pool.range(generator.minTheta, generator.maxTheta));
  const polar = MathUtils.degToRad(pool.range(generator.minPhi, generator.maxPhi));
  const ring = Math.sin(polar);
  const direction = new Vector3(ring * Math.cos(azimuth), -Math.cos(polar), ring * Math.sin(azimuth));
  direction.applyQuaternion(new Quaternion().fromArray(generator.rotation));
  if (generator.controlPosition) {
    const fraction = Math.pow(pool.random(), generator.distributionExponent ?? 1);
    const radius = generator.minRadius + fraction * (generator.maxRadius - generator.minRadius);
    particle.position.fromArray(generator.position).addScaledVector(direction, radius);
  }
  if (generator.controlVelocity) {
    particle.velocity.copy(direction).multiplyScalar(pool.range(generator.minSpeed, generator.maxSpeed));
  }
}

export function generateParticleAttributes(particle, emitter, pool) {
  for (const generator of emitter.generators ?? []) {
    if (generator.valid === false) continue;
    const type = generator.type;
    if (type.endsWith('Tr2SphereShapeAttributeGenerator')) fillSphere(particle, generator, pool);
    else if (type.endsWith('Tr2RandomUniformAttributeGenerator')) fillRange(particle, generator, pool, false);
    else if (type.endsWith('Tr2RandomIntegerAttributeGenerator')) fillRange(particle, generator, pool, true);
  }
}
