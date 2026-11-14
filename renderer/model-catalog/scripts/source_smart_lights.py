"""Build the SmartLight inputs published by the hull's own SOF effect children."""
from sof_parameters import faction_color
from sof_texture_schema import COLOR_NAMES
from source_smart_light_graph import CAMERA_DEFAULTS


def standalone_effect_children(definitions):
    # GetHullChildren/GetHullChildSets select the first DNA hull in both SOF versions.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L1981-L2011
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L2148-L2174
    hulls, faction, visible, modern = definitions
    if not hulls:
        return
    if modern:
        children = (child for group in hulls[0].get('childSets', [])
                    if group.get('visibilityGroup', 'primary') in visible for child in group.get('items', []))
    else:
        by_group = {c.get('groupIndex', -1): c.get('isVisible', False) for c in faction.get('children', [])}
        children = (c for c in hulls[0].get('children', []) if by_group.get(c.get('groupIndex', -1), True))
    yield from (child for child in children if child.get('buildFilter', 0xffffffff) & 1)


def hull_effect_children(definitions):
    for child in standalone_effect_children(definitions):
        path = child.get('redFilePath', '').lower()
        if path.endswith(('.red', '.black')):
            yield path, child


def rig_paths(definitions):
    for path, _ in hull_effect_children(definitions):
        yield path


def placed_effect_root(root, child):
    # For standalone hulls the outer SOF offset is identity. Setup replaces
    # the root SRT (and rebuilds its matrix) only when the child uses SRT.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L2041-L2064
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/EveChildTransform.cpp#L27-L45
    if not root.get('useSRT', True):
        return root
    placed = dict(root, translation=child.get('translation', [0, 0, 0]),
                  rotation=child.get('rotation', [0, 0, 0, 1]), scaling=child.get('scaling', [1, 1, 1]))
    placed.pop('localTransform', None)
    return placed


def active_color(node, faction, custom):
    # EveSmartLightBaseGroup::GetGroupColor and AttributeModifierColor::GetBlendColor.
    index = node.get('factionColor', -1)
    if node.get('useFactionColor') and faction.get('colorSet') is not None and 0 <= index < len(COLOR_NAMES):
        return faction_color(faction, index)
    return custom


def modifier(node, types, faction):
    kind = types[id(node)]
    out = dict(node, type='trinity.' + kind)
    if kind.endswith('CameraDependency'):
        out = {**CAMERA_DEFAULTS, **out}
    elif kind.endswith('Color'):
        out = {**dict(blendValue=1, brightnessMultiplier=1, saturationMultiplier=1), **out}
        out['activeBlendColor'] = active_color(node, faction, node.get('blendColor', [0, 0, 0, 1]))
    elif kind.endswith('ControllerVariableListener'):
        out.setdefault('defaultValue', 0)
    if 'attributeModifiers' in node:
        out['attributeModifiers'] = [modifier(child, types, faction) for child in node['attributeModifiers']]
    return out


def shader_reference(effect):
    return dict(resource=effect['effectFilePath'], options=list(effect.get('options', {}).items()))


def light_group(node, types, faction, shared_color=None):
    kind = types[id(node)]
    custom = shared_color if shared_color is not None else node.get('customColor', [0, 0, 0, 1])
    color = active_color(node, faction, custom)
    out = dict(node, type='trinity.' + kind, customColor=custom, activeColor=color,
               attributeModifiers=[modifier(m, types, faction) for m in node.get('attributeModifiers', [])])
    if 'lightGroups' in node:
        # EveSmartLightColorShareGroup::UpdateAsyncronous forwards the group color to the children.
        out['lightGroups'] = [light_group(g, types, faction, color) for g in node['lightGroups']]
    elif kind == 'EveSmartLightQuad':
        # Constructor, softQuad switch and null-effect draw condition:
        # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/SmartLightSets/EveSmartLightQuad.cpp#L10-L65
        if 'effect' not in node:
            name = 'flarequadsoft.fx' if node.get('softQuad') else 'FlareQuad.fx'
            out['sourceShader'] = dict(resource='res:/Graphics/Effect/Managed/Space/SpecialFX/' + name, options=[])
        elif node['effect'] and node['effect'].get('effectFilePath'):
            out['sourceShader'] = shader_reference(node['effect'])
        else:
            out['display'] = False
        out.setdefault('staticQuadScale', [1, 1, 1])
        out.setdefault('brightness', 1)
    elif kind in ('EveSmartLightPointLight', 'EveSmartLightSpotLight'):
        out = {**dict(radius=0, innerRadius=0, innerAngle=0, outerAngle=0, brightness=1), **out}
    elif kind == 'EveSmartLightMesh':
        out.setdefault('shaderParamColorName', '')  # EveSmartLightMesh constructor
        out.setdefault('staticOffsetRotation', [0, 0, 0, 1])
        out.setdefault('staticOffsetScale', [1, 1, 1])
        mesh = node['mesh']
        out['mesh'] = dict(mesh, sourceShader=shader_reference(mesh['additiveAreas'][0]['effect']))
    return out


def source_light_rigs(resources, definitions):
    """Each root is referenced by this DNA. Preserve individual source-set names and order."""
    result = []
    for path in rig_paths(definitions):
        rig = resources.smart_rig(path) if resources.has(path) else None
        if rig is None:
            continue
        root_name, nodes, types = rig
        sets = [dict(name=node.get('name', ''), distribution=dict(placementGenerators=node['distribution']['placementGenerators']),
            groups=[light_group(g, types, definitions[1]) for g in node['lightGroups']]) for node in nodes]
        result.append((root_name, sets))
    return result


def uses_hull_light_order(item, definitions):
    # SetupEffects appends each standalone child at identity. The layout pass
    # appends additional children only for layout DNA. Gate VFX have a separate owner.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L251-L290
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFDNA.cpp#L312-L316
    commands = {token.partition('?')[0] for token in item['dna'].lower().split(':')[3:]}
    return bool(definitions[0]) and 'layout' not in commands and not (item.get('gateEffects') or item.get('groupID') == 10)


def scene_rigs(roots):
    # A scene marker contains only a root name. Ambiguous names need the scene's own groups.
    named = {}
    for name, sets in roots:
        if name not in named:
            named[name] = sets
        elif sets != named[name]:
            named[name] = None
    return {name: sets for name, sets in named.items() if sets is not None}


def assembled_light_sets(roots, record, hull_order):
    if hull_order:
        return [group for _, sets in roots for group in sets]
    return expand_source_sets(record, scene_rigs(roots))


def set_locator_names(light_sets):
    return [g.get('locatorSetName', 'damage') for s in light_sets for g in s['distribution']['placementGenerators']]


def rig_locators(rigs):
    return {root: set_locator_names(sets) for root, sets in rigs.items()}


def expand_source_sets(record, rigs):
    sets = []
    for entry in record.get('smartLightSets', []):
        if 'sourceRig' in entry:
            sets.extend(rigs[entry['sourceRig']])
        else:
            sets.append(entry)
    return sets
