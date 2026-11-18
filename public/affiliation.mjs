// The Builder publishes the faction ID resolved from each item's DNA race.
// Faction icons live under R2; items without a faction use their official icon.
export const OTHER_FACTION = -1;

const factionForRace = new Map(Object.entries({
  caldari: 500001,
  minmatar: 500002,
  amarr: 500003,
  gallente: 500004,
  jove: 500005,
  jovebase: 500005,
  concord: 500006,
  concordbase: 500006,
  concordcivilian: 500006,
  concordmilitary: 500006,
  ammatar: 500007,
  khanid: 500008,
  syndicate: 500009,
  guristas: 500010,
  angel: 500011,
  angelbase: 500011,
  bloodraider: 500012,
  evermore: 500013,
  ore: 500014,
  orebase: 500014,
  ore_consortium: 500014,
  thukker: 500015,
  soe: 500016,
  soebase: 500016,
  soct: 500017,
  soctbase: 500017,
  mordu: 500018,
  mordubase: 500018,
  sansha: 500019,
  sanshabase: 500019,
  sansha_winter: 500019,
  serpentis: 500020,
  drifter: 500024,
  rogue: 500025,
  roguebase: 500025,
  triglavian: 500026,
  triglavianbase: 500026,
  edencom: 500027,
  'upwell-edencom': 500027,
  air: 500028,
  air_structure: 500028,
  deathless: 500029,
}));

export function factionIconSource(factionID, typeID) {
  const id = Number(factionID);
  if (Number.isSafeInteger(id) && id > 0) return `res/icons/factions/${id}.png`;
  const type = Number(typeID);
  if (Number.isSafeInteger(type) && type > 0)
    return `https://images.evetech.net/types/${type}/icon?size=64`;
  return '';
}

export function createAffiliationResolver() {
  return item => {
    const direct = Number(item.factionID);
    if (Number.isSafeInteger(direct) && direct > 0)
      return { affiliationID: direct, factionID: direct, affiliationSource: 'faction-id' };
    const parts = typeof item.dna === 'string' ? item.dna.split(':') : [];
    const race = parts.length >= 3 && parts[2] ? parts[2].toLowerCase() : '';
    const inferred = factionForRace.get(race);
    if (inferred)
      return { affiliationID: inferred, factionID: inferred, affiliationSource: 'dna-race' };
    return { affiliationID: OTHER_FACTION, factionID: null, affiliationSource: 'other' };
  };
}
