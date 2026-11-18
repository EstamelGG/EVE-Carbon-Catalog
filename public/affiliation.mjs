// SDE factionID is authoritative when it names a known faction. Items whose
// SDE value is missing or is an NPC corporation ID fall back to the faction
// token in DNA's second component, then to the SDE raceID.
export const OTHER_FACTION = -1;

const knownFactions = new Set([
  500001, 500002, 500003, 500004, 500005, 500006, 500007, 500008, 500009,
  500010, 500011, 500012, 500013, 500014, 500015, 500016, 500017, 500018,
  500019, 500020, 500021, 500024, 500025, 500026, 500027, 500028, 500029,
]);

const factionForDNA = new Map(Object.entries({
  sanshabase: 500019,
  bloodraider: 500012,
  serpentis: 500020,
  angelbase: 500011,
  guristas: 500010,
  mordubase: 500018,
  soebase: 500016,
  soctbase: 500017,
  orebase: 500014,
  ore_consortium: 500014,
  triglavianbase: 500026,
  concordcivilian: 500006,
  deathless: 500029,
  roguebase: 500025,
  drifter: 500024,
  jovebase: 500005,
  concordbase: 500006,
  concordmilitary: 500006,
  'upwell-edencom': 500027,
  air: 500028,
  air_structure: 500028,
  ammatar: 500007,
  khanid: 500008,
  syndicate: 500009,
  sansha_winter: 500019,
}));

const factionForRace = new Map(Object.entries({
  1: 500001,
  2: 500002,
  4: 500003,
  8: 500004,
  16: 500005,
  128: 500014,
  134: 500025,
  135: 500026,
}).map(([race, faction]) => [Number(race), faction]));

// Older records may carry race IDs; map them onto the shared faction icons.
const iconFactionAliases = factionForRace;

export function factionIconSource(factionID, typeID) {
  const raw = Number(factionID);
  const id = iconFactionAliases.get(raw) ?? raw;
  if (Number.isSafeInteger(id) && id > 0) return `res/icons/factions/${id}.png`;
  const type = Number(typeID);
  if (Number.isSafeInteger(type) && type > 0)
    return `https://images.evetech.net/types/${type}/icon?size=64`;
  return '';
}

export function createAffiliationResolver(identities = {}) {
  const factions = identities?.factions?.length
    ? new Set(identities.factions.map((faction) => Number(faction.id)))
    : knownFactions;
  return (item) => {
    const explicit = Number(item.factionID);
    if (factions.has(explicit))
      return { affiliationID: explicit, factionID: explicit, affiliationSource: 'sde-faction' };
    const parts = typeof item.dna === 'string' ? item.dna.split(':') : [];
    const token =
      parts.length >= 3 && parts.slice(0, 3).every(Boolean) ? parts[1].toLowerCase() : '';
    const inferred = factionForDNA.get(token);
    if (factions.has(inferred))
      return { affiliationID: inferred, factionID: inferred, affiliationSource: 'dna-faction' };
    const raceFaction = factionForRace.get(Number(item.raceID));
    if (factions.has(raceFaction))
      return { affiliationID: raceFaction, factionID: raceFaction, affiliationSource: 'sde-race' };
    return { affiliationID: OTHER_FACTION, factionID: null, affiliationSource: 'other' };
  };
}
