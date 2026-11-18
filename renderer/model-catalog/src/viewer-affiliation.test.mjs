import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveViewerAffiliation } from './viewer-affiliation.mjs';

test('the DNA race field is the only affiliation source', () => {
  const result = resolveViewerAffiliation(
    { dna: 'cc2_t1:guristas:caldari', factionID: 500003, raceID: 4 },
    { faction: { id: 500002, en: 'Minmatar Republic', zh: '米玛塔尔共和国' } },
  );
  assert.equal(result.factionID, 500001);
  assert.equal(result.faction.en, 'Caldari State');
  assert.equal(result.source, 'dna-race');
});

test('published item shards use their DNA race', () => {
  assert.equal(
    resolveViewerAffiliation({ dna: 'cc3_t1:caldaribase:caldari', raceID: 1 }).factionID,
    500001,
  );
  assert.equal(
    resolveViewerAffiliation({ dna: 'cc2_t1:guristas:caldari', raceID: 1 }).factionID,
    500001,
  );
  assert.equal(
    resolveViewerAffiliation({ dna: 'cf6_t2:laidai:caldari', raceID: 1 }).factionID,
    500001,
  );
});

test('non-empire race tokens use their hard-coded faction', () => {
  assert.equal(resolveViewerAffiliation({ dna: 'x:angel:angel' }).factionID, 500011);
  assert.equal(resolveViewerAffiliation({ dna: 'x:sansha:sansha' }).factionID, 500019);
  assert.equal(resolveViewerAffiliation({ dna: 'x:rogue:rogue' }).factionID, 500025);
  assert.equal(resolveViewerAffiliation({ dna: 'x:triglavian:triglavian' }).factionID, 500026);
});

test('generic and unmapped race tokens become other', () => {
  for (const dna of [
    'x:caldaribase:generic',
    'x:sleeperbase:sleeper',
    'x:custom:unknown',
    'not-a-dna',
  ]) {
    const result = resolveViewerAffiliation({ dna, raceID: 1 });
    assert.equal(result.factionID, null);
    assert.deepEqual(result.faction, { id: null, en: 'Other', zh: '其他' });
    assert.equal(result.kind, 'other');
  }
});
