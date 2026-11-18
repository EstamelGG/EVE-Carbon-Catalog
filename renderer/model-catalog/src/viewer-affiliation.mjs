const factionNames = new Map([
  [500001, { en: 'Caldari State', zh: '加达里合众国' }],
  [500002, { en: 'Minmatar Republic', zh: '米玛塔尔共和国' }],
  [500003, { en: 'Amarr Empire', zh: '艾玛帝国' }],
  [500004, { en: 'Gallente Federation', zh: '盖伦特联邦' }],
  [500005, { en: 'Jove Empire', zh: '朱庇特帝国' }],
  [500006, { en: 'CONCORD Assembly', zh: '统一合作关系部 (统合部)' }],
  [500007, { en: 'Ammatar Mandate', zh: '艾玛达共和国' }],
  [500008, { en: 'Khanid Kingdom', zh: '卡尼迪王国' }],
  [500009, { en: 'The Syndicate', zh: '辛迪加财团' }],
  [500010, { en: 'Guristas Pirates', zh: '古斯塔斯海盗' }],
  [500011, { en: 'Angel Cartel', zh: '天使企业联合体' }],
  [500012, { en: 'Blood Raider Covenant', zh: '血袭者同盟' }],
  [500013, { en: 'EverMore', zh: '长青船业' }],
  [500014, { en: 'ORE', zh: '联合矿业' }],
  [500015, { en: 'Thukker Tribe', zh: '图克尔部落' }],
  [500016, { en: 'Servant Sisters of EVE', zh: '姐妹共济会' }],
  [500017, { en: 'The Society of Conscious Thought', zh: '真理会' }],
  [500018, { en: "Mordu's Legion Command", zh: '莫德团' }],
  [500019, { en: "Sansha's Nation", zh: '萨沙共和国' }],
  [500020, { en: 'Serpentis', zh: '天蛇集团' }],
  [500021, { en: 'Unknown', zh: '未知' }],
  [500024, { en: 'Drifters', zh: '流浪者' }],
  [500025, { en: 'Rogue Drones', zh: '自由无人机' }],
  [500026, { en: 'Triglavian Collective', zh: '三神裔' }],
  [500027, { en: 'EDENCOM', zh: '伊甸联合防御阵线' }],
  [
    500028,
    {
      en: 'Association for Interdisciplinary Research',
      zh: '跨学科研究协会（星空会）',
    },
  ],
  [500029, { en: 'Deathless Circle', zh: '不死循环' }],
]);

const knownFactions = new Set(factionNames.keys());

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

const factionForRace = new Map([
  [1, 500001],
  [2, 500002],
  [4, 500003],
  [8, 500004],
  [16, 500005],
  [128, 500014],
  [134, 500025],
  [135, 500026],
]);

const other = Object.freeze({ id: null, en: 'Other', zh: '其他' });

export function factionIconSource(factionID, typeID) {
  const raw = Number(factionID);
  const id = factionForRace.get(raw) ?? raw;
  if (Number.isSafeInteger(id) && id > 0) return `res/icons/factions/${id}.png`;
  const type = Number(typeID);
  if (Number.isSafeInteger(type) && type > 0)
    return `https://images.evetech.net/types/${type}/icon?size=64`;
  return '';
}

export function resolveViewerAffiliation(item = {}, explicit = {}) {
  const stored = item.viewerIdentity || {};
  const type = explicit.type ?? stored.type ?? '';
  const explicitID = [
    explicit.factionID,
    explicit.faction?.id,
    stored.factionID,
    stored.faction?.id,
    item.factionID,
  ]
    .map(Number)
    .find((id) => knownFactions.has(id));
  const faction = explicitID ? factionNames.get(explicitID) : null;
  if (faction) {
    return {
      factionID: explicitID,
      faction: { id: explicitID, ...faction },
      kind: 'faction',
      source: 'faction-id',
      type,
    };
  }
  const parts = typeof item.dna === 'string' ? item.dna.split(':') : [];
  const token =
    parts.length >= 3 && parts.slice(0, 3).every(Boolean) ? parts[1].toLowerCase() : '';
  const inferredID = factionForDNA.get(token);
  const inferred = knownFactions.has(inferredID) ? factionNames.get(inferredID) : null;
  if (inferred) {
    return {
      factionID: inferredID,
      faction: { id: inferredID, ...inferred },
      kind: 'faction',
      source: 'dna-faction',
      type,
    };
  }
  const raceID = factionForRace.get(Number(item.raceID));
  const raceFaction = knownFactions.has(raceID) ? factionNames.get(raceID) : null;
  if (raceFaction) {
    return {
      factionID: raceID,
      faction: { id: raceID, ...raceFaction },
      kind: 'faction',
      source: 'sde-race',
      type,
    };
  }
  return { factionID: null, faction: other, kind: 'other', source: 'other', type };
}
