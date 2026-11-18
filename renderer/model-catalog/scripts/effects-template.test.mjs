import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleEffects} from './effects-template.js';
import {mergeChildren} from './hull-definition.js';
import {GateAnimation} from './gate-animation.js';

test('shared hull resolves faction visibility, race style and independent child placements',async()=>{
  const child={lights:[{color:{colorSlot:0},transforms:[{effectRoot:true}]}]};
  const records={library:{version:4,factions:{a:{url:'a'},b:{url:'b'}},races:{r:{url:'race'}}},
    a:{definition:{visibilityGroupSet:{visibilityGroups:['a']}},colors:[[1,0,0,1]]},
    b:{definition:{visibilityGroupSet:{visibilityGroups:['b']}},colors:[[0,1,0,1]]},
    race:{parameters:{scale:2},textures:{},lights:{}},child};
  const template={version:4,kind:'sof-hull-effects',hull:'h',library:{url:'library'},
    fixed:{fixtures:[],booster:{placements:[{}]}},rules:['a','b'].map((visible,i)=>({field:'children',visible,
      draws:[{effectResource:{url:'child'},placement:{translation:[i+1,0,0]}}]}))};
  const load=async key=>records[key];
  const a=await assembleEffects(template,'h:a:r',load),b=await assembleEffects(template,'h:b:r',load);
  assert.deepEqual(a.supplements.lights[0].color,[1,0,0,1]);
  assert.deepEqual(b.supplements.lights[0].color,[0,1,0,1]);
  assert.deepEqual(a.supplements.lights[0].transforms[0].translation,[1,0,0]);
  assert.deepEqual(b.supplements.lights[0].transforms[0].translation,[2,0,0]);
  assert.equal(a.booster.parameters.scale,2);
  assert.deepEqual(child,{lights:[{color:{colorSlot:0},transforms:[{effectRoot:true}]}]});
  await assert.rejects(()=>assembleEffects({...template,version:3},'h:a:r',load),/Unsupported/);
});

test('shared child effects resolve inherited faction colors per hull',async()=>{
  const records={library:{version:4,factions:{a:{url:'a'},b:{url:'b'}},races:{r:{url:'race'}}},
    a:{definition:{visibilityGroupSet:{visibilityGroups:['a']}},colors:[[1,0,0,1]]},
    b:{definition:{visibilityGroupSet:{visibilityGroups:['b']}},colors:[[0,1,0,1]]},
    race:{parameters:{},textures:{},lights:{}},
    child:{gate:{animation:{targets:[{color:{$colorSlot:0}}],completeStates:true,sets:[{name:'loop',
      duration:1,fps:1,tracks:[{target:0,field:'color',values:[{$colorSlot:0}]}]}]},
      meshes:[],particles:[],flares:[],lines:[],lights:[],unsupported:[]}}};
  const template={version:4,kind:'sof-hull-effects',hull:'h',library:{url:'library'},
    fixed:{fixtures:[],booster:{placements:[]}},rules:['a','b'].map(visible=>({field:'children',visible,
      draws:[{effectResource:{url:'child'},placement:{translation:[0,0,0]}}]}))};
  const load=async key=>records[key];
  const a=await assembleEffects(template,'h:a:r',load),b=await assembleEffects(template,'h:b:r',load);
  assert.deepEqual(a.gate.animation.targets[0].color,[1,0,0,1]);
  assert.deepEqual(b.gate.animation.targets[0].color,[0,1,0,1]);
});

test('merging repeated child resources preserves lines, motion, gate targets and parameter bindings',()=>{
  const child={lines:[{transforms:[{motionTrack:0}]}],motionTracks:[{rotation:{channels:[]}}],gate:{
    animation:{targets:[{value:0}],completeStates:true,sets:[{name:'loop',duration:1,fps:1,
      tracks:[{target:0,field:'value',values:[0,2]}]}]},
    meshes:[{material:{fxParameters:{Gain:0}},transforms:[{fxID:0}]}],particles:[{particleNodeIndex:0,emitters:[{fxID:0}]}]}};
  const {supplements,gate}=mergeChildren([child,child]);
  assert.equal(supplements.lines.length,2);
  assert.deepEqual(supplements.lines.map(l=>l.transforms[0].motionTrack),[0,1]);
  assert.deepEqual(gate.meshes.map(m=>m.material.fxParameters.Gain),[0,1]);
  assert.deepEqual(gate.particles.map(p=>p.particleNodeIndex),[0,1]);
  const animation=new GateAnimation(gate.animation);
  assert.deepEqual(animation.evaluate(.5).map(t=>t.value),[1,1]);
  assert.equal(child.gate.meshes[0].material.fxParameters.Gain,0);
});

test('recipe hulls keep authored instanced meshes outside the rule list',async()=>{
  const records={library:{version:4,factions:{a:{url:'a'}},races:{r:{url:'race'}}},
    a:{definition:{},colors:[]},race:{parameters:{},textures:{},lights:{}}};
  const template={version:4,kind:'sof-hull-effects',hull:'h',library:{url:'library'},
    fixed:{fixtures:[],booster:{placements:[]},instancedMeshes:[{name:'group',instances:[[0,0,0,0,0,0,1,1,1,1,0]]}]},rules:[]};
  const result=await assembleEffects(template,'h:a:r',async key=>records[key]);
  assert.equal(result.instancedMeshes,undefined);
  assert.equal(result.supplements.meshes.length,1);
  assert.equal(result.supplements.meshes[0].name,'group');
  assert.equal(result.supplements.meshes[0].instances.length,1);
});
