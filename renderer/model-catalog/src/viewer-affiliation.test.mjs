import assert from 'node:assert/strict';
import test from 'node:test';
import { factionIconSource, resolveViewerAffiliation } from './viewer-affiliation.mjs';
import { resolveViewerIdentity } from './viewer-identity.mjs';

test('a known SDE faction ID is authoritative', () => {
  const result = resolveViewerAffiliation({
    dna: 'cc2_t1:guristas:caldari',
    factionID: 500003,
    raceID: 4,
  });
  assert.equal(result.factionID, 500003);
  assert.equal(result.faction.en, 'Amarr Empire');
  assert.equal(result.source, 'faction-id');
});

test('an explicit identity faction ID overrides the item record', () => {
  const result = resolveViewerAffiliation(
    { dna: 'cc2_t1:guristas:caldari', factionID: 500003 },
    { factionID: 500002 },
  );
  assert.equal(result.factionID, 500002);
  assert.equal(result.faction.en, 'Minmatar Republic');
});

test('an NPC corporation ID falls back to the DNA faction token', () => {
  const result = resolveViewerAffiliation({
    dna: 'sf2_t1:sanshabase:sansha',
    factionID: 1000162,
    raceID: 32,
  });
  assert.equal(result.factionID, 500019);
  assert.equal(result.faction.en, "Sansha's Nation");
  assert.equal(result.source, 'dna-faction');
});

test('pirate hulls keep their authored DNA faction when SDE has no faction', () => {
  assert.equal(
    resolveViewerAffiliation({ dna: 'cc2_t1:guristas:caldari', raceID: 1 }).factionID,
    500010,
  );
  assert.equal(
    resolveViewerAffiliation({ dna: 'ab2_t1:bloodraider:amarr', raceID: 4 }).factionID,
    500012,
  );
  assert.equal(
    resolveViewerAffiliation({ dna: 'gc4_t1:serpentis:gallente', raceID: 8 }).factionID,
    500020,
  );
});

test('SDE raceID is the final fallback when DNA has no faction token', () => {
  assert.equal(
    resolveViewerAffiliation({ dna: 'cc3_t1:caldaribase:caldari', raceID: 1 }).factionID,
    500001,
  );
  assert.equal(
    resolveViewerAffiliation({ dna: 'ab1_t1:amarrbase:amarr', raceID: 4 }).factionID,
    500003,
  );
  assert.equal(
    resolveViewerAffiliation({ dna: 'ore1_t1:orebase:ore', raceID: 128 }).factionID,
    500014,
  );
});

test('generic, sleeper and unmapped items become other', () => {
  for (const item of [
    { dna: 'x:caldaribase:generic' },
    { dna: 'x:sleeperbase:sleeper', raceID: 64 },
    { dna: 'x:custom:unknown' },
    { dna: 'not-a-dna' },
  ]) {
    const result = resolveViewerAffiliation(item);
    assert.equal(result.factionID, null);
    assert.deepEqual(result.faction, { id: null, en: 'Other', zh: '其他' });
    assert.equal(result.kind, 'other');
  }
});

test('faction icons prefer the published faction ID', () => {
  assert.equal(factionIconSource(500010, 17918), 'res/icons/factions/500010.png');
  assert.equal(factionIconSource(1, 17918), 'res/icons/factions/500001.png');
});

test('other items fall back to their official type icon', () => {
  assert.equal(
    factionIconSource(null, 64034),
    'https://images.evetech.net/types/64034/icon?size=64',
  );
  assert.equal(
    factionIconSource(-1, 54733),
    'https://images.evetech.net/types/54733/icon?size=64',
  );
  assert.equal(factionIconSource(null, null), '');
});

test('viewer identity selects the item type icon for other affiliations', () => {
  const identity = resolveViewerIdentity({ id: 64034, dna: 'x:custom:generic' });
  assert.equal(identity.kind, 'other');
  assert.equal(
    identity.factionIconSource,
    'https://images.evetech.net/types/64034/icon?size=64',
  );
});
