"""Source-driven lighting selection and serialization; independent of Blender.

Prefer a complete supported authored rig over its SmartLight alternative. Keep
independent supported clusters when no SmartLight alternative would overlap.
"""

from resource_errors import MissingResourceError

TRANSFORM_FIELDS = (
    'type', 'name', 'display', 'translation', 'rotation', 'scaling',
    'localTransform', 'useSRT', 'staticTransform', 'useStaticScale',
    'useStaticRotation', 'transformModifiers',
)
AUTHORED_TYPES = {
    'trinity.EveChildContainer', 'trinity.EveChildQuad', 'trinity.EveChildMesh',
}
AUTHORED_MODIFIERS = {
    'trinity.EveChildModifierSRT',
    'trinity.EveChildModifierHalo',
    'trinity.EveChildModifierCameraOrientedRotationConstrained',
}
BEAM_LAYERS = {'ONE': 1, 'TWO': 2, 'THREE': 3}
BEAM_OPTIONS = {
    'VARIATION': {'REGULAR'},
    'DIFFUSE_MAP_COUNT': set(BEAM_LAYERS),
    'MASK_TEXTURE_SAMPLING': {'WRAP'},
    'MASK_TRANSFORM': {'OFF'},
}
# These switches do not change the supported spotlight material. New
# client permutations may omit the old depth toggle altogether. Never infer
# missing material options or accept active clipping/debug variants.
BEAM_OPTIONAL = {
    'UBER_DEPTH': {'UBER_DEPTH_ON', 'UBER_DEPTH_OFF'},
    'V5_DEBUG': {'OFF'},
    'SPACE_OBJECT_CLIPPING': {'SOC_DISABLED'},
    'BINDLESS_RENDERING': {'BINDLESS_RENDERING_DISABLED'},
}


def walk(node):
    if not isinstance(node, dict):
        raise ValueError('Incomplete lighting capture; recapture authored lighting tree')
    yield node
    children = node.get('objects', [])
    if not isinstance(children, list):
        raise ValueError('Incomplete lighting capture; recapture authored lighting tree')
    for child in children:
        yield from walk(child)


def shader_name(effect):
    return effect.get('effectFilePath', '').lower().rsplit('/', 1)[-1]


def shader_options(effect):
    options = dict(effect.get('optionDefaults', []))
    options.update(effect.get('options', []))
    return options


def authored_issues(sets, read_options=shader_options):
    """Check the whole rig before creating any output assets."""
    issues = set()
    for rig in sets:
        for node in [*rig['parents'], *walk(rig['node'])]:
            if node.get('type') not in AUTHORED_TYPES:
                issues.add('node:' + str(node.get('type')))
            for modifier in node.get('transformModifiers', []):
                if modifier['type'] not in AUTHORED_MODIFIERS:
                    issues.add('modifier:' + modifier['type'])
            for flag in ('useStaticScale', 'useStaticRotation'):
                if node.get(flag):
                    issues.add('transform:' + flag)
            if node.get('curveSets'):
                issues.add('local-animation-curves')
            if node.get('type') == 'trinity.EveChildQuad':
                if shader_name(node.get('effect', {})) != 'flarequad.fx':
                    issues.add('quad-shader:' + shader_name(node.get('effect', {})))
            if node.get('type') != 'trinity.EveChildMesh':
                continue
            mesh = node.get('mesh') or {}
            areas = mesh.get('additiveAreas', [])
            if len(areas) != 1:
                issues.add('beam-area-count')
                continue
            effect = areas[0]['effect']
            if shader_name(effect) != 'ubershader.fx':
                issues.add('beam-shader:' + shader_name(effect))
                continue
            try:
                options = read_options(effect)
            except MissingResourceError as error:
                issues.add('missing-effect-resource:' + error.resource)
                continue
            for name, supported in BEAM_OPTIONS.items():
                if options.get(name) not in supported:
                    issues.add('beam-option:' + name + '=' + str(options.get(name)))
            for name in options.keys() - BEAM_OPTIONS.keys():
                if name not in BEAM_OPTIONAL:
                    issues.add('beam-option:' + name)
                elif options[name] not in BEAM_OPTIONAL[name]:
                    issues.add('beam-option:' + name + '=' + str(options[name]))
            parameters = dict(effect.get('constParameters', []))
            parameters.update({p['name']: p['value'] for p in effect.get('parameters', [])})
            layers = range(1, 1 + BEAM_LAYERS.get(options.get('DIFFUSE_MAP_COUNT'), 0))
            required = {'FresnelFactors', 'DiffuseColor'}
            required.update(prefix + str(i) for i in layers for prefix in ('TextureTransform', 'TextureScroll'))
            issues.update('parameter:' + name for name in required - parameters.keys())
            textures = {r['name'] for r in effect.get('resources', [])}
            required_maps = {'MaskMap', *('DiffuseMap' + str(i) for i in layers)}
            issues.update('texture:' + name for name in required_maps - textures)
    return sorted(issues)


def pack_mesh(mesh, assets, read_options):
    area = mesh['additiveAreas'][0]
    effect = area['effect']
    parameters = dict(effect.get('constParameters', []))
    parameters.update({p['name']: p['value'] for p in effect.get('parameters', [])})
    authored = dict(effect.get('options', []))
    options = authored if 'DIFFUSE_MAP_COUNT' in authored else read_options(effect)
    layers = BEAM_LAYERS.get(options.get('DIFFUSE_MAP_COUNT'))
    packed = dict(
        sourceShader=mesh.get('sourceShader') or assets.shader(effect),
        geometry=assets.mesh(mesh['geometryResPath'], mesh.get('meshIndex', 0), area.get('index', 0),
                             area.get('count', 1), area.get('reversed', False)),
        parameters=parameters,
        textures={r['name']: assets.texture(r['resourcePath']) for r in effect['resources']},
    )
    if layers is not None:
        packed['beamLayers'] = layers
    return packed


def pack_authored(node, assets, read_options):
    out = {k: node[k] for k in (*TRANSFORM_FIELDS, 'color', 'brightness', 'minScreenSize') if k in node}
    out['objects'] = [pack_authored(child, assets, read_options) for child in node.get('objects', [])]
    if node.get('effect'):
        out['sourceShader'] = assets.shader(node['effect'])
    if node.get('mesh'):
        out.update(pack_mesh(node['mesh'], assets, read_options))
    return out


def pack_rig(rig, assets, read_options):
    result = dict(parents=rig['parents'], node=pack_authored(rig['node'], assets, read_options))
    if 'sourceRigPath' in rig:
        result['sourceRigPath'] = rig['sourceRigPath']
    return result


def pack_smart(node, assets, read_options=shader_options):
    fields = ('type', 'name', 'display', 'sourceShader', 'activeColor', 'customColor', 'useFactionColor', 'factionColor', 'brightness',
              'shaderParamColorName', 'staticQuadScale', 'staticOffsetTranslation', 'staticOffsetRotation',
              'staticOffsetScale', 'rotationConstraint', 'radius', 'innerRadius',
              'innerAngle', 'outerAngle', 'attributeModifiers')
    out = {k: node[k] for k in fields if k in node}
    if 'lightGroups' in node:
        out['lightGroups'] = [pack_smart(child, assets, read_options) for child in node['lightGroups']]
    if node.get('mesh'):
        out.update(pack_mesh(node['mesh'], assets, read_options))
    return out


def smart_candidates(record):
    locators = {s['name']: s['locators'] for s in record.get('locatorSets', [])}
    for lightset in record.get('smartLightSets', []):
        groups = lightset['groups']
        point_sources = groups and all(g.get('type') == 'trinity.EveSmartLightPointLight' for g in groups)
        for generator in lightset['distribution']['placementGenerators']:
            name = generator.get('locatorSetName', 'damage')
            if locators.get(name) and (point_sources or 'spotlight' in name.lower()):
                yield dict(name=name, placements=locators[name], groups=groups)



def pack_surface_group(node, assets):
    """Retain real SmartLight sources/parent modifiers, never duplicate VFX."""
    if node.get('display') is False:
        return None
    if 'lightGroups' in node:
        children = [child for source in node['lightGroups']
                    if (child := pack_surface_group(source, assets)) is not None]
        if not children:
            return None
        parent = dict(node, lightGroups=[])
        parent.pop('mesh', None)
        out = pack_smart(parent, assets)
        out['lightGroups'] = children
        return out
    if node.get('type') not in ('trinity.EveSmartLightSpotLight', 'trinity.EveSmartLightPointLight'):
        return None
    return pack_smart(node, assets)


def pack_surface_sets(smart, assets):
    sets = []
    for source in smart:
        groups = [group for node in source['groups']
                  if (group := pack_surface_group(node, assets)) is not None]
        if groups:
            sets.append(dict(name=source['name'], placements=source['placements'], groups=groups))
    return sets


def pack_lighting(record, assets, read_options=shader_options):
    authored = record.get('authoredSpotlights', [])
    smart = list(smart_candidates(record))
    issues = authored_issues(authored, read_options)
    if authored and not issues:
        mode = 'authored'
        sets = [pack_rig(s, assets, read_options) for s in authored]
    elif smart:
        mode = 'smart' if smart else 'none'
        sets = [dict(name=s['name'], placements=s['placements'],
                     groups=[pack_smart(g, assets, read_options) for g in s['groups']]) for s in smart]
    else:
        # With no alternative rig, independent supported clusters can be shown.
        supported = [s for s in authored if not authored_issues([s], read_options)]
        mode = 'authored' if supported else 'none'
        sets = [pack_rig(s, assets, read_options) for s in supported]
    surface_sets = pack_surface_sets(smart, assets) if mode == 'authored' else []
    return dict(
        mode=mode, sets=sets, surfaceSets=surface_sets,
        sourceCounts=dict(authored=len(authored), smart=sum(len(s['placements']) for s in smart)),
        unsupported=issues,
        omittedSets=len(authored) - len(sets) if mode != 'smart' else 0,
        limitations=([('surface-light-approximation' if surface_sets else 'surface-lights'), 'controller-transitions', 'soft-depth', 'volumetric-fog',
                      'display-space-compositing'] if mode == 'authored' else
                     ['surface-light-approximation', 'controller-transitions', 'soft-depth',
                      'volumetric-fog'] if mode == 'smart' else []),
    )

