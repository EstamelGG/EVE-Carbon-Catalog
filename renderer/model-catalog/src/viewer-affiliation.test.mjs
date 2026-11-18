import assert from 'node:assert/strict';
import test from 'node:test';
import { factionIconSource, resolveViewerAffiliation } from './viewer-affiliation.mjs';
import { resolveViewerIdentity } from './viewer-identity.mjs';

test('the published faction ID is the primary affiliation source', () => {
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

test('DNA race remains a compatibility fallback without a faction ID', () => {
  assert.equal(
    resolveViewerAffiliation({ dna: 'cc3_t1:caldaribase:caldari', raceID: 1 }).factionID,
    500001,
  );
  assert.equal(resolveViewerAffiliation({ dna: 'x:angel:angel' }).factionID, 500011);
  assert.equal(resolveViewerAffiliation({ dna: 'x:sansha:sansha' }).factionID, 500019);
  assert.equal(resolveViewerAffiliation({ dna: 'x:rogue:rogue' }).factionID, 500025);
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

test('faction icons prefer the published faction ID', () => {
  assert.equal(factionIconSource(500010, 17918), 'res/icons/factions/500010.png');
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
