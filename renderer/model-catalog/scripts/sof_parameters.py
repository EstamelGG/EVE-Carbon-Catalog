"""Resolve authored SOF shader parameters from resource data.

CCP Trinity, MIT (docs/licenses/carbon-trinity-MIT.txt): GetMeshAreaParameter,
SearchForParameterData, LoadFactionData, LoadRaceData, FillMeshAreaVector.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFDNA.cpp#L1254-L1362
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFUtils.cpp#L172-L218
"""
from black_projection import BlackProjection
from sof_texture_schema import COLOR_NAMES


class SofProjection(BlackProjection):
    def field(self, kind):
        if kind == 'strings':
            return [entry.get('str', '') for entry in super().field('records')]
        if kind != 'parameter_map':
            return super().field(kind)
        result = {}
        for entry in super().field('records'):
            # EveSOFData.cpp: typed GetValue() splats scalars and zero-extends vectors.
            value = entry.get('value', [0.] * 4)
            if not isinstance(value, list):
                value = [float(value)] * 4
            result[entry.get('name', '')] = value + [0.] * (4 - len(value))
        return result


def faction_color(faction, index):
    colors = faction.get('colorSet')
    if colors is None:
        return [0.] * 4
    name = COLOR_NAMES[index]
    if name in colors:
        return colors[name]
    if name == 'PrimaryBillboard':
        return [2.5] * 4
    # EveSOFDataFactionColorSet constructor defaults, Color(uint32_t ARGB).
    special = {'PrimaryWarpFx': 0xFF6333, 'PrimaryDockedFX': 0x4C82E2,
               'PrimaryAttackFX': 0xFF180B, 'PrimarySiegeFX': 0xFF5E2D}
    rgb = special.get(name, 0)
    return [((rgb >> shift) & 255) / 255 for shift in (16, 8, 0)] + [1.]


def material_slot(name, prefixes):
    for index, prefix in enumerate(prefixes):
        if name.lower().startswith(prefix.lower()):
            return index, name[len(prefix):]
    return None, name


class SurfaceParameters:
    def __init__(self, resources, commands, hull, faction, race):
        self.resources = resources
        self.materials = commands.get('material', [])
        self.patterns = commands.get('pattern', [])[1:]
        self.modern = hull.get('sof6', False)
        self.faction = faction
        self.race = race

    def palette(self, material, key):
        if material and material.lower() != 'none':
            return self.resources.material(material).get(key)

    def area_value(self, sections, name, slot, short):
        for section in sections:
            if section is None:
                continue
            if name == 'GeneralGlowColor':
                return faction_color(self.faction, section.get('colorType', COLOR_NAMES.index('Hull')))
            if slot is not None:
                material = section.get('material%d' % (slot + 1))
                if material:
                    # Primary supplies an unassigned slot. A named material
                    # owns its slot even if it does not define this parameter.
                    return self.palette(material, short)

    def parameter(self, area, area_type, name):
        generic = self.resources.generic
        slot, short = material_slot(name, generic.get('materialPrefixes', []))
        if slot is not None and slot < len(self.materials) and not area.get('blockedMaterials', 0) & (1 << slot):
            value = self.palette(self.materials[slot], short)
            if value is not None:
                return value
        pattern, suffix = material_slot(name, generic.get('patternMaterialPrefixes', []))
        if pattern is not None:
            if pattern < len(self.patterns):
                value = self.palette(self.patterns[pattern], suffix)
                if value is not None:
                    return value
            if pattern == 0 or (pattern == 1 and self.modern):
                value = self.palette(self.faction.get('defaultPatternLayer%dMaterialName' % (pattern + 1)), suffix)
                if value is not None:
                    return value

        if area_type == 'Wreck':
            value = self.area_value([generic.get('genericWreckMaterial')], name, slot, short)
            if value is not None:
                return value
        if name == 'GeneralHeatGlowColor' and area_type in ('Primary', 'Reactor'):
            choice = 'Booster' if area_type == 'Primary' else 'Reactor'
            index = self.race.get('hull%sHeatColorType' % area_type, COLOR_NAMES.index(choice))
            return faction_color(self.faction, index)
        sections = self.faction.get('areaTypes') or {}
        choices = [sections.get(area_type)]
        if area_type != 'Primary':
            choices.append(sections.get('Primary'))
        value = self.area_value(choices, name, slot, short)
        if value is not None:
            return value
        return area.get('parameters', {}).get(name)

    def for_area(self, area, area_type, shader):
        # Tr2Effect::AddParameterVector4 keeps the first assignment. Generic
        # defaults fill only names left unbound by the ordered lookup.
        result = dict(shader.get('defaultParameters', {}))
        for name in shader.get('parameters', []):
            value = self.parameter(area, area_type, name)
            if value is not None:
                result[name] = value
        return result
