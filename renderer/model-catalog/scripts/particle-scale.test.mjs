import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3,Quaternion} from 'three';
import {particleTransformScale,spriteScaleControls} from './particle-billboard.js';
import {ParticleDynamics} from './particle-dynamics.js';

test('native scale measure retains rotation and nonuniform scale',()=>{
  const matrix=new Matrix4().compose(new Vector3(10,20,30),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.7),new Vector3(2,3,4));
  assert.ok(Math.abs(particleTransformScale(matrix)-Math.sqrt(29/3))<1e-12);
});
test('velocity stretch follows native units across model normalization and large emitter scales',()=>{
  for(const parentScale of [1,517.9275,1035.855])for(const normalization of [.0002,.5,1])for(const useWorldScale of [0,1]){
    const size=.8,velocity=2,stretch=16000;
    const control=spriteScaleControls({UseWorldScale:useWorldScale,VelocityStretch:stretch},parentScale,parentScale*normalization);
    const corner=normalization*size*control.sizeScale,viewVelocity=normalization*parentScale*velocity;
    const actual=corner*viewVelocity*control.fullStretch;
    const expected=normalization*size*velocity*stretch*(useWorldScale?1:parentScale);
    assert.ok(Math.abs(actual-expected)<Math.max(1,expected)*1e-12);
  }
});
test('omitted native attractor position means the origin',()=>{
  const dynamics=new ParticleDynamics({elements:[{elementType:1},{elementType:2}],forces:[{type:'trinity.Tr2ParticleAttractorForce',magnitude:2}]});
  const particle={position:new Vector3(1,0,0),velocity:new Vector3(),mass:1};
  dynamics.update([particle],.25);
  assert.equal(particle.velocity.x,-.5);assert.equal(particle.position.x,.875);
});
