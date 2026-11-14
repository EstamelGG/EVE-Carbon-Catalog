"""Build SmartLight placement lists from authored hull locator sets."""
from ctypes import c_float

from sof_locators import placed_hulls


def _locator_sets(entries):
    # Trinity recursively appends the members of each named set in file order.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFDataMgr.cpp#L1205-L1228
    for entry in entries:
        if entry.get('locators'):
            yield entry
        yield from _locator_sets(entry.get('locatorSets', []))


def spotlight_locators(hulls, named_sets=()):
    # Root hulls use the identity placement. Multi-hulls add the connector
    # offset to each position and append sets of the same name across parts.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L3358-L3446
    sets = {}
    for hull, offset in placed_hulls(hulls):
        for group in _locator_sets(hull.get('locatorSets', [])):
            name = group.get('name', '')
            if name not in named_sets and 'spotlight' not in name.lower():
                continue
            placements = sets.setdefault(name, [])
            for locator in group['locators']:
                position = [c_float(a + b).value for a, b in zip(locator.get('position', [0, 0, 0]), offset)]
                placements.append([position, locator.get('rotation', [0, 0, 0, 1]),
                                   locator.get('scaling', [1, 1, 1]), locator.get('boneIndex', -1), 0])
    return sets


def lighting_locators(root_sets, record):
    sets = {name: list(rows) for name, rows in root_sets.items()}
    # Older capture files contain the entire list. Keep only placements appended
    # by scene children, whose own layout is still handled by the scene worker.
    for entry in record.get('locatorSets', []):
        name = entry['name']
        if name in sets or 'spotlight' in name.lower():
            root = sets.setdefault(name, [])
            root.extend(entry['locators'][len(root):])
    for name, extra in record.get('childSpotlightLocators', {}).items():
        sets.setdefault(name, []).extend(extra)
    return [dict(name=name, locators=rows) for name, rows in sets.items()]


def light_inputs_for_catalog(cache, items):
    """Supply root locator counts and authored rig names to the standalone scene worker."""
    from sof_resources import SofResources
    from sof_attachments import attachment_definitions
    from source_authored_lights import hull_spotlight_clusters
    from source_smart_lights import rig_locators, scene_rigs, source_light_rigs, uses_hull_light_order
    resources = SofResources(cache)
    result = {}
    for item in items:
        if item.get('available') and item.get('dna'):
            definitions = attachment_definitions(resources, item['dna'])
            if uses_hull_light_order(item, definitions):
                plan = dict(hullLightOrder=True)
                clusters = hull_spotlight_clusters(resources, definitions)
                if clusters:
                    plan['sourceRigPaths'] = [rig['sourceRigPath'] for rig in clusters]
                result[str(item['id'])] = plan
                continue
            names = rig_locators(scene_rigs(source_light_rigs(resources, definitions)))
            wanted = {name for rig in names.values() for name in rig}
            counts = {name: len(rows) for name, rows in spotlight_locators(definitions[0], wanted).items()}
            result[str(item['id'])] = dict(rootCounts=counts, rigs=names)
    return result
