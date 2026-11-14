// SOURCE AUDIT 2026-11-11 [E05]: Official turbulence correspondence; seeded PRNG and GPU-emitter approximation are local adaptations.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
// Reference: https://github.com/ccpgames/ccpwgl/blob/c31632d0fb7d9f0be19a5eb5452e5d5f74a914c5/src/math/noise.js
import { Vector3 } from 'three';
import {gpuParticleBirth} from './gpu-particle-birth.js';
import { generateParticleAttributes } from './particle-generators.js';
import { ParticleDynamics } from './particle-dynamics.js';
import {GpuParticleDynamics} from './gpu-particle-dynamics.js';
import {gpuParticleTint} from './gpu-particle-curves.js';
import {defaultMaxGpuParticles} from './gpu-particle-slots.js';

const mix=(a,b,t)=>a+(b-a)*t;
const vector=(a=[0,0,0])=>new Vector3(...a.slice(0,3));
class GateParticleEmitter {
  constructor(record) {
    this.record = record;
    // Bind named generators to the declared scalar lanes. CUSTOM2 is also
    // used for RGBA or UV offsets, so only an angular-rate scalar qualifies.
    const scalarName = slot => record.systems?.[0]?.elements?.find(element =>
      element.elementType === 4 && element.usedByGPU && element.usageIndex === slot && element.dimension === 1)?.customName;
    const initial = scalarName(1), rate = scalarName(2);
    if(initial==='spin' || initial==='rotation')this.rotationAttribute=initial;
    if(rate==='spinVel' || rate==='rotationVelocity')this.rotationRateAttribute=rate;
    if(record.materials?.some(material=>material.shader==='1layerdynv2.fx')){
      this.rotationAttribute=initial;
      this.atlasAttribute=scalarName(3);
    }
    this.resetEmitter();
  }
  random(){this.seed=(Math.imul(1664525,this.seed)+1013904223)>>>0;return this.seed/4294967296;}
  range(a,b){return mix(a,b,this.random());}
  resetEmitter(){this.staticLoaded=false;this.remainder=0;this.emittedCount=0;this.seed=12345;}
  spawn(emitter) {
    const gpu=emitter.type.endsWith('GpuUniqueEmitter');
    const defaultLife = gpu ? 0 : 1;
    const minLife=emitter.minLifeTime??defaultLife, maxLife=emitter.maxLifeTime??defaultLife;
    const sample=this.random();
    // Update.fx reads the high 16 bits of emitterSeed and divides by 65535.
    const fraction=gpu ? Math.floor(sample*65536)/65535 : sample;
    const life=mix(minLife,maxLife,fraction);
    const p={position:vector(emitter.position),velocity:new Vector3(),age:0,
      life,size:1,spin:0,spinVelocity:0,mass:1};
    // Static cloud systems use dynamic emitters to fill a fixed pool, but have
    // no LIFETIME element. Trinity never ages or replaces those particles.
    const elements=this.record.systems?.[0]?.elements;
    if(!gpu&&elements&&!elements.some(e=>e.elementType===0))p.life=Infinity;
    if(gpu) {
      // Keep the viewer's repeatable birth stream; Trinity seeds each GPU request with rand().
      gpuParticleBirth(p, emitter, () => this.random(), this.motion);
      // The preview feeds the same stored UNORM16 seed to the public size and lifetime functions.
      p.gpuSeed=fraction;
    } else {
      generateParticleAttributes(p, emitter, this);
    }
    return p;
  }
  emitStatic(items,capacity) {
    if(this.staticLoaded)return;
    const fields=this.record.systems?.[0]?.elements||[];
    const seeded=(this.record.staticParticles||[]).slice(0,capacity).map(v=>{
      const p={position:vector(v.Position),velocity:new Vector3(),age:0,life:Infinity,size:1,spin:0,spinVelocity:0,color:[1,1,1,1]};
      for(const f of fields){
        if(f.elementType===0){
          const [fraction=0,duration=0]=v.Tangent??[];
          p.life=duration;p.age=fraction*duration;
        } else if(f.elementType===2) p.velocity.copy(vector(v.Normal));
        else if(f.elementType===3) {
          const mass=v.Binormal??v.Bitangent;
          p.mass=(Array.isArray(mass)?mass[0]:mass)??0;
        }
        const value=v['TextureCoordinates'+f.usageIndex];
        if(f.customName==='size')p.size=(Array.isArray(value)?value[0]:value)??0;
        if(f.customName==='rotation'||f.customName==='spin'){
          const angle=(Array.isArray(value)?value[0]:value)??0;
          p.spin=f.customName===this.rotationAttribute?angle*Math.PI/180:angle;
        }
        if(this.rotationRateAttribute && f.customName===this.rotationRateAttribute)
          p.spinVelocity=(Array.isArray(value)?value[0]:value)??0;
        if(f.customName==='color')p.color=value??[0,0,0,0];
      }return p;
    });
    items.length=0;
    for(const particle of seeded)items.push(particle);
    this.staticLoaded=true;
  }
  emitInto(items, capacity, dt, emitter, enabled, burst) {
    if(emitter.type.endsWith('StaticEmitter')){this.emitStatic(items,capacity);return;}
    const gpu = emitter.type.endsWith('GpuUniqueEmitter');
    const active = emitter.isValid !== false;
    const rate = enabled && active ? Math.max(0, emitter.rate ?? 0) : 0;
    this.remainder += dt * rate;
    const whole = Math.floor(this.remainder);
    this.remainder -= whole;
    let births = active ? whole + burst : 0;
    // Tr2DynamicEmitter::SpawnParticles counts requested births before inserting
    // them into the bounded live pool. maxParticles is the lifetime quota.
    if (!gpu && emitter.maxParticles >= 0) {
      births = Math.min(births, Math.max(0, emitter.maxParticles - this.emittedCount));
    }
    this.emittedCount += births;
    for (let i = 0; i < births && items.length < capacity; i++) {
      const slot = this.gpuSlots?.allocate();
      if (slot === -1) break;
      const particle = this.spawn(emitter);
      if (slot !== undefined) particle.gpuSlot = slot;
      items.push(particle);
    }
  }
}

export class GateParticlePool extends GateParticleEmitter {
  constructor(record, capacity=record.emitter?.type?.endsWith('GpuUniqueEmitter') ? defaultMaxGpuParticles : 2048, siblingRecords=[]) {
    super(record);
    this.capacity = capacity;
    this.otherEmitters = siblingRecords.map(sibling => new GateParticleEmitter(sibling));
    this.dynamics = new ParticleDynamics(record.systems?.[0]);
    this.gpuDynamics = new GpuParticleDynamics();
    this.reset();
  }

  reset() {
    this.releaseGpuSlots();
    this.items = [];
    this.resetEmitter();
    for (const emitter of this.otherEmitters) emitter.resetEmitter();
    this.dynamics.time = 0;
    this.gpuTime = 0;
    this.staticLoaded = false;
  }

  releaseGpuSlots() {
    if (!this.gpuSlots) return;
    for (const particle of this.items) this.gpuSlots.free.push(particle.gpuSlot);
    this.items.length = 0;
  }

  trigger(emitter,siblings) {
    if (emitter.type.endsWith('GpuUniqueEmitter')) {
      // Tr2GpuSharedEmitter::SpawnParticles with one unit rate modifier has
      // zero carry-in. Tr2GpuParticleSystem::Emit clamps that request.
      const count = Math.min(this.capacity, Math.max(0, Math.trunc(emitter.rate ?? 0)));
      this.emitInto(this.items,this.capacity,0,emitter,false,count);
    } else {
      // Dynamic emitters retain fractional carry across individual spawn calls.
      this.emitInto(this.items,this.capacity,1,emitter,true,0);
      for (let i=0;i<siblings.length;i++)
        this.otherEmitters[i].emitInto(this.items,this.capacity,1,siblings[i],true,0);
    }
  }

  step(dt, emitter, enabled=true, burst=0, siblings=[], integrate=true) {
    const gpu=emitter.type.endsWith('GpuUniqueEmitter');
    this.emitInto(this.items, this.capacity, dt, emitter, enabled, burst);
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      const count = burst ? Math.max(0, Math.trunc(sibling.rate ?? 0)) : 0;
      this.otherEmitters[i].emitInto(this.items, this.capacity, dt, sibling, enabled, count);
    }
    if (!gpu) {
      if (integrate && dt>0) this.dynamics.update(this.items, dt);
      return;
    }
    this.gpuTime += dt;
    this.gpuDynamics.step(this.items, emitter, dt, this.gpuTime);
    this.items=this.items.filter(p=>{
      const alive=p.age<p.life&&!Number.isNaN(p.position.x)&&!Number.isNaN(p.position.y)&&!Number.isNaN(p.position.z);
      if (!alive && this.gpuSlots) this.gpuSlots.expired.push(p.gpuSlot);
      return alive;
    });
  }
}

export function particleColor(p, emitter, parameters) {
  if(p.color)return p.color;
  const t=p.life>0?Math.min(1,p.age/p.life):0;
  if(emitter.type.endsWith('GpuUniqueEmitter'))return gpuParticleTint(emitter,t);
  const white=[1,1,1,1];
  const start=parameters.Color1??white;
  const control=parameters.Color2??start;
  const end=parameters.Color3??control;
  const midpoint=Math.max(0,Math.min(1,emitter.colorMidpoint??parameters.ColorMidpoint?.[0]??.5));
  if(t<=0)return start;
  if(t>=1)return end;
  const first=t<midpoint;
  const a=first?start:control, b=first?control:end;
  const weight=first?t/midpoint:(t-midpoint)/(1-midpoint);
  return a.map((v,k)=>mix(v,b[k],weight));
}
