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

// Published item records carry the Builder-resolved faction ID. The third DNA
// component remains a compatibility fallback for records from older indexes;
// the DNA faction token and SDE raceID never decide the affiliation.
const factionForRace = new Map([
  ['caldari', 500001],
  ['minmatar', 500002],
  ['amarr', 500003],
  ['gallente', 500004],
  ['jove', 500005],
  ['jovebase', 500005],
  ['concord', 500006],
  ['concordbase', 500006],
  ['concordcivilian', 500006],
  ['concordmilitary', 500006],
  ['ammatar', 500007],
  ['khanid', 500008],
  ['syndicate', 500009],
  ['guristas', 500010],
  ['angel', 500011],
  ['angelbase', 500011],
  ['bloodraider', 500012],
  ['evermore', 500013],
  ['ore', 500014],
  ['orebase', 500014],
  ['ore_consortium', 500014],
  ['thukker', 500015],
  ['soe', 500016],
  ['soebase', 500016],
  ['soct', 500017],
  ['soctbase', 500017],
  ['mordu', 500018],
  ['mordubase', 500018],
  ['sansha', 500019],
  ['sanshabase', 500019],
  ['sansha_winter', 500019],
  ['serpentis', 500020],
  ['drifter', 500024],
  ['rogue', 500025],
  ['roguebase', 500025],
  ['triglavian', 500026],
  ['triglavianbase', 500026],
  ['edencom', 500027],
  ['upwell-edencom', 500027],
  ['air', 500028],
  ['air_structure', 500028],
  ['deathless', 500029],
]);

const other = Object.freeze({ id: null, en: 'Other', zh: '其他' });

export function factionIconPath(factionID) {
  const id = Number(factionID);
  const name = Number.isSafeInteger(id) && id > 0 ? id : 'default_logo';
  return `res/icons/factions/${name}.png`;
}

export function resolveViewerAffiliation(item = {}, explicit = {}) {
  const stored = item.viewerIdentity || {};
  const type = explicit.type ?? stored.type ?? '';
  const parts = typeof item.dna === 'string' ? item.dna.split(':') : [];
  const race = parts.length >= 3 && parts[2] ? parts[2].toLowerCase() : '';
  const explicitID = Number(explicit.factionID ?? explicit.faction?.id ?? item.factionID);
  const storedID = Number(stored.factionID ?? stored.faction?.id);
  const publishedID = Number.isSafeInteger(explicitID) && explicitID > 0
    ? explicitID
    : Number.isSafeInteger(storedID) && storedID > 0
      ? storedID
      : null;
  const factionID = publishedID ?? factionForRace.get(race);
  if (!factionID) return { factionID: null, faction: other, kind: 'other', source: 'other', type };
  const faction = factionNames.get(factionID);
  return {
    factionID,
    faction: faction ? { id: factionID, ...faction } : { id: factionID, ...other },
    kind: 'faction',
    source: publishedID ? 'faction-id' : 'dna-race',
    type,
  };
}
