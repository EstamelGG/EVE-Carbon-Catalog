"""Resolve a typeID to its default SOF DNA from local JSONL SDE."""
from pathlib import Path
import json
import re


def row(folder, table, key):
    path = Path(folder) / (table + '.jsonl')
    with path.open(encoding='utf-8-sig') as stream:
        for line in stream:
            value = json.loads(line)
            if value.get('_key') == key:
                return value
    raise ValueError('%s does not contain ID %s' % (path.name, key))


def resolve_records(item, graphic, material_set=None, metadata=None):
    """Resolve already-indexed SDE rows without scanning tables per item."""
    type_id = item['_key']
    graphic_id = item.get('graphicID')
    if graphic_id is None:
        raise ValueError('typeID %s has no graphicID; this item has no exportable hull' % type_id)
    hull = graphic.get('sofHullName')
    if not hull:
        raise ValueError('typeID %s is not a SOF hull. Turrets, stations and scene assemblies are not supported yet.' % type_id)
    faction = graphic.get('sofFactionName') or 'generic'
    race = graphic.get('sofRaceName') or 'generic'
    suffix = ''
    if graphic.get('sofMaterialSetID') is not None:
        if material_set is None:
            raise ValueError('Missing graphic material set %s' % graphic['sofMaterialSetID'])
        faction = material_set.get('sofFactionName') or faction
        race = material_set.get('sofRaceHint') or race
        suffix += ':material?' + ';'.join(material_set.get('material%d' % i) or 'None' for i in range(1, 5))
        if material_set.get('sofPatternName'):
            suffix += ':pattern?' + ';'.join([material_set['sofPatternName'], material_set.get('custommaterial1') or 'None', material_set.get('custommaterial2') or 'None'])
        if material_set.get('resPathInsert'):
            suffix += ':respathinsert?' + material_set['resPathInsert']
    if graphic.get('sofLayout'):
        suffix += ':layout?' + ';'.join(graphic['sofLayout'])
    english = item.get('name', {}).get('en', 'ship')
    slug = re.sub('[^a-z0-9]+', '-', english.lower()).strip('-') or 'ship'
    return dict(typeID=type_id, name=item.get('name', {}), slug=slug, graphicID=graphic_id,
                dna='%s:%s:%s%s' % (hull, faction, race, suffix),
                graphicMaterialSet=material_set, sde=metadata or {})


def resolve_type(folder, type_id):
    item = row(folder, 'types', type_id)
    graphic = row(folder, 'graphics', item.get('graphicID'))
    material_set = (row(folder, 'graphicMaterialSets', graphic['sofMaterialSetID'])
                    if graphic.get('sofMaterialSetID') is not None else None)
    metadata = {}
    path = Path(folder) / '_sde.jsonl'
    if path.exists():
        with path.open(encoding='utf-8-sig') as stream:
            metadata = json.loads(next(stream))
    return resolve_records(item, graphic, material_set, metadata)
