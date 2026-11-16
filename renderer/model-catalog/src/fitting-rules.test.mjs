import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveFittingRules,fittingRuleBucket} from './fitting-rules.mjs';

test('faction slot remapping precedes DNA overrides and keeps explicit zero colors',async()=>{
  const records={index:{version:2,mode:'sof-turret-rules',materialPrefixes:['Mtl1','Mtl2','Mtl3','Mtl4'],
    factions:{[fittingRuleBucket('base')]:'factions'},materials:{[fittingRuleBucket('steel')]:'materials',[fittingRuleBucket('paint')]:'materials'}},
    faction:{materialUsage:[1,0,2,3],sections:[{materials:['steel','steel',null,null],glowColor:[2,3,4,1]}]},
    steel:{DiffuseColor:[1,1,1,1],Gloss:[.5,0,0,0]},paint:{DiffuseColor:[0,0,0,0]}};
  records.factions={base:records.faction};records.materials={steel:records.steel,paint:records.paint};
  const dna='h:base:r:material?none;paint';
  const result=await resolveFittingRules('index',dna,async url=>records[url]);
  const p=result.profiles[result.byDNA[dna]];
  assert.deepEqual(p.Mtl1DiffuseColor,[0,0,0,0]);assert.deepEqual(p.Mtl2DiffuseColor,[1,1,1,1]);
  assert.deepEqual(p.Mtl1Gloss,[.5,0,0,0]);assert.deepEqual(p.GeneralGlowColor,[2,3,4,1]);
  assert.equal(p.Mtl3DiffuseColor,undefined);
});
