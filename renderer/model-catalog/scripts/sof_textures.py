"""Resolve a SOF hull assembly's authored surface texture bindings directly from BLACK.

CCP Trinity (MIT, docs/licenses/carbon-trinity-MIT.txt): EveSOF::FillMeshAreaVector,
EveSOFDNA::ModifyTextureResPath / GetPatternApplicationData, EveSOFDataMgr's
pattern import and Tr2Effect::AddResourceTexture2D (first binding wins).
https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Shader/Tr2Effect.cpp#L424-L440
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

from material_defaults import PALETTE_SURFACES, runtime_material_parameters, surface_family
from sof_geometry import geometry_for_dna, hull_bounding_sphere
from sof_patterns import pattern_layers
from sof_parameters import SurfaceParameters
from sof_texture_schema import AREA_LISTS, AREA_TYPES
from sof_resources import SofResources, UnsupportedSofDNA

# Compatibility for callers of the original surface-only entry point.
SofTextureResources = SofResources
UnsupportedTextureDNA = UnsupportedSofDNA

TRANSPARENCY = {'opaqueAreas': 'SOT_OPAQUE', 'decalAreas': 'SOT_CLIP', 'transparentAreas': 'SOT_TRANSPARENT'}


def faction_texture(resources, path, insert):
    if insert:
        directory, slash, filename = path.rpartition('/')
        candidate = directory + slash + (insert + '/' if slash else '') + filename
        stem, separator, suffix = candidate.rpartition('_')
        if separator:
            variant = stem + '_' + insert + '_' + suffix
            if resources.has(variant):
                return variant
    return path


def mesh_areas(hulls):
    # EveSOF::SetupShaders offsets each subsystem by the number of entries in
    # all five original area lists, including distortion and alpha-cutout.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L2368-L2388
    offset = 0
    for hull in hulls:
        for kind in AREA_LISTS:
            for area in hull.get(kind, []):
                yield kind, area, offset
        offset += sum(len(hull.get(kind, [])) for kind in AREA_LISTS)


def parse_surface_dna(dna):
    parts = dna.lower().split(':')
    if len(parts) < 3 or not all(parts[0].split(';')):
        raise UnsupportedTextureDNA('Expected SOF hull, faction and race')
    hull_name, faction_name, race_name = parts[:3]
    commands = {}
    for segment in parts[3:]:
        command, sep, value = segment.partition('?')
        if not sep or command not in ('material', 'pattern', 'respathinsert'):
            raise UnsupportedTextureDNA('Unsupported surface command: ' + segment)
        commands[command] = value.split(';')
    return hull_name, faction_name, race_name, commands


def texture_insert(faction, commands):
    override = commands.get('respathinsert', [])
    if len(override) == 1:
        return None if override[0] == 'none' else override[0]
    return faction.get('resPathInsert')


def surface_textures(resources, dna):
    hull_name, faction_name, race_name, commands = parse_surface_dna(dna)
    hulls = [resources.named('hulls', name, 'Hull') for name in hull_name.split(';')]
    # EveSOFDNA selects animation, SOF generation and pattern projection from hull zero.
    hull = hulls[0]
    faction = resources.named('factions', faction_name, 'Faction')
    race = resources.named('races', race_name, 'Race')
    parameters = SurfaceParameters(resources, commands, hull, faction, race)
    generic = resources.generic
    shaders = {item['shader']: item for item in generic['areaShaders']}
    insert = texture_insert(faction, commands)
    pattern_name = commands.get('pattern', [None])[0]
    layers = pattern_layers(resources, hull, faction, pattern_name)
    # EveSOFDNA::GetPatternLayerCount also enables the legacy hull projection
    # when its faction supplies no named texture to sample.
    legacy_default = (not pattern_name and not hull.get('sof6') and
                      (hull.get('defaultPattern') or {}).get('transformLayer1') is not None)
    pattern_enabled = bool(layers) or legacy_default
    prefix = generic.get('shaderPrefixAnimated' if hull.get('isSkinned') else 'shaderPrefix', '')

    areas = []
    for kind, area, offset in mesh_areas(hulls):
        shader = area['shader']
        if shader not in shaders:
            raise UnsupportedTextureDNA('Missing generic shader definition: ' + shader)
        textures = {t['name']: faction_texture(resources, t['resFilePath'], insert)
                    for t in area.get('textures', [])}
        area_type = AREA_TYPES[area.get('areaType', 0)]
        defaults = shaders[shader].get('defaultTextures', [])
        declared_roles = {entry['name'] for entry in defaults}
        projections = []
        samplers = []
        for layer in layers:
            if layer.flags.get(area_type, True) and layer.role:
                textures.setdefault(layer.role, layer.texture['textureResFilePath'])
                samplers.append(layer.sampler())
                if layer.role in declared_roles and layer.transform is not None:
                    projections.append(layer.mask())
        for resource in defaults:
            textures.setdefault(resource['name'], resource['resFilePath'])
        directory, slash, filename = shader.rpartition('/')
        effect = generic['areaShaderLocation'] + '/' + directory + slash + prefix + filename
        # SetupShaders appends alpha-tested decal areas to the opaque draw list.
        # FillMeshAreaVector still selects SOT_CLIP from the authored batch type.
        # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L2369-L2383
        mode = TRANSPARENCY.get(kind)
        options = [('SPACE_OBJECT_TRANSPARENCY', mode)] if mode else []
        # FillMeshAreaVector publishes the permutation on each effect and the
        # sampler override on each applicable layer, including shader-default maps.
        # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L843-L872
        options.append(('SPACE_OBJECT_PPT_ENABLED', 'SOPPT_ENABLED' if pattern_enabled else 'SOPPT_DISABLED'))
        areas.append(dict(kind='opaqueAreas' if kind == 'decalAreas' else kind,
                          name=area.get('name', ''), index=offset + area.get('index', 0), count=area.get('count', 1),
                          options=options, samplers=samplers, effect=effect, textures=textures, sofPatterns=projections,
                          parameters=parameters.for_area(area, area_type, shaders[shader])))
    geometry = hull['geometryResFilePath'] if len(hulls) == 1 else geometry_for_dna(resources, dna)
    return dict(dna=dna, geometry=geometry, areas=areas, boundingSphere=hull_bounding_sphere(hulls),
                fixedSphere=not any(h.get('enableDynamicBoundingSphere') for h in hulls),
                customMasks=[layer.mask() for layer in layers if layer.role and layer.transform is not None])


def authored_hull_surface(resources, dna):
    try:
        return require_hull_surface(resources, dna)
    except (UnsupportedTextureDNA, FileNotFoundError):
        return None


def require_hull_surface(resources, dna):
    """Resolve authored surfaces, preserving the cause when a hull cannot be exported."""
    from surface_passes import check_overlay_inputs, overlay_profile
    resolved = surface_textures(resources, dna)
    # Distortion is a separate Trinity render target. It has no draw call in
    # the catalog surface pass; opaque, cutout, transparent and additive do.
    areas = [a for a in resolved['areas'] if a['kind'] != 'distortionAreas']
    if not areas:
        raise UnsupportedTextureDNA('Hull has no renderable surface areas: ' + dna)
    surface = dict(areas=areas, customMasks=resolved['customMasks'], surfaceSource='sof')
    sphere = resolved['boundingSphere']
    if resolved['fixedSphere'] and sphere and sphere[3] > 0:
        surface.update(sourceRadius=sphere[3], sourceCenter=sphere[:3], sourceRadiusOrigin='sof-hull-boundingSphere')
    for area in areas:
        if surface_family(area['effect']) in PALETTE_SURFACES:
            area['parameters'] = runtime_material_parameters(area['effect'], area['parameters'])
        elif profile := overlay_profile(area):
            try:
                check_overlay_inputs(area, profile)
            except ValueError as error:
                raise UnsupportedTextureDNA(f"{area['effect']}: {error}") from error
            # SetupMesh uses the authored sphere after subsystem placement.
            # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFDNA.cpp#L1120-L1141
            sphere = resolved['boundingSphere']
            if sphere and sphere[3] > 0:
                surface['overlayRadius'] = sphere[3]
        else:
            raise UnsupportedTextureDNA('Unsupported hull surface shader: ' + area['effect'])
    return surface


def apply_surface_textures(hull, resources):
    """Replace independently resolved bindings on unambiguous authored draw calls."""
    try:
        resolved = surface_textures(resources, hull['dna'])
    except (UnsupportedTextureDNA, FileNotFoundError) as exc:
        hull.setdefault('warnings', []).append('SOF 贴图沿用已有记录：' + str(exc))
        return
    if resolved['geometry'].replace('\\', '/').lower() != hull['geometry'].replace('\\', '/').lower():
        hull.setdefault('warnings', []).append('组装后几何与 SOF 舰体不同，贴图沿用已有记录')
        return

    def draw(area):
        return area['kind'], area['index'], area['count'], area['effect'].lower()

    authored = defaultdict(list)
    for area in resolved['areas']:
        authored[draw(area)].append(area)
    existing = Counter(draw(area) for area in hull['areas'])
    for area in hull['areas']:
        key = draw(area)
        matches = authored.get(key, [])
        if len(matches) == 1 and existing[key] == 1:
            area['textures'].update(matches[0]['textures'])
            source = matches[0]
            area['sofPatterns'] = source['sofPatterns']
            overrides = [s for s in area.get('samplers', []) if s['name'] not in
                         ('PatternMask1MapSampler', 'PatternMask2MapSampler')]
            area['samplers'] = overrides + source['samplers']
            options = dict(area.get('options', []))
            options['SPACE_OBJECT_PPT_ENABLED'] = dict(source['options'])['SPACE_OBJECT_PPT_ENABLED']
            area['options'] = list(options.items())
            resolved_parameters = matches[0]['parameters']
            if surface_family(area['effect']) in PALETTE_SURFACES:
                area['parameters'] = runtime_material_parameters(area['effect'], resolved_parameters)
            else:
                area.setdefault('parameters', {}).update(resolved_parameters)
    if all('sofPatterns' in area for area in hull['areas'] if area['kind'] != 'depthAreas'):
        hull['customMasks'] = resolved['customMasks']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--dna', required=True)
    args = parser.parse_args()
    print(json.dumps(surface_textures(SofTextureResources(args.cache), args.dna), indent=2))
