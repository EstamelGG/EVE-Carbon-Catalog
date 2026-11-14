"""Incremental, content-deduplicated owner-DNA material profiles for fitted equipment."""
import hashlib
import json
import math

from sof_parameters import SurfaceParameters, material_slot
from sof_texture_schema import AREA_TYPES
from source_equipment import PARAMETERS


def validate_parameters(parameters, sparse=False):
    if not isinstance(parameters, dict) or (set(parameters) - set(PARAMETERS) if sparse else set(parameters) != set(PARAMETERS)):
        raise ValueError('Incomplete fitting material parameters')
    for name, values in parameters.items():
        if not isinstance(values, list) or len(values) != 4 or not all(
                isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values):
            raise ValueError('Invalid fitting parameter: ' + name)
    return parameters


def turret_lookup(generic, faction, name):
    prefixes = generic.get('materialPrefixes', [])
    slot, suffix = material_slot(name, prefixes)
    if slot is None:
        return name
    usage = faction.get('materialUsageMtl%d' % (slot + 1), slot)
    return prefixes[usage] + suffix


def turret_parameters(resources, dna):
    # CCP Trinity (MIT), EveSOFDNA::GetFactionTurretParameters remaps the slot
    # before looking up the generic turret area, with no per-mesh parameters.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFDNA.cpp#L1370-L1382
    hulls, faction_name, race_name, *options = dna.lower().split(':')
    faction = resources.named('factions', faction_name, 'Faction')
    commands = {}
    for option in options:
        name, _, value = option.partition('?')
        commands[name] = value.split(';')
    hull = resources.named('hulls', hulls.split(';')[0], 'Hull')
    race = resources.named('races', race_name, 'Race')
    surface = SurfaceParameters(resources, commands, hull, faction, race)
    generic = resources.generic
    area_type = AREA_TYPES[generic.get('turretAreaType', 0)]
    result = {}
    for name in PARAMETERS:
        lookup = turret_lookup(generic, faction, name)
        value = surface.parameter({}, area_type, lookup)
        if value is not None:
            result[name] = value
    return result


def owner_appearance(resources, dnas):
    by_dna, profiles = {}, {}
    for dna in sorted(set(dnas)):
        if dna not in resources.turret_profiles:
            values = validate_parameters(turret_parameters(resources, dna), sparse=True)
            encoded = json.dumps(values, sort_keys=True, separators=(',', ':')).encode()
            resources.turret_profiles[dna] = (hashlib.sha256(encoded).hexdigest(), values)
        digest, values = resources.turret_profiles[dna]
        profiles[digest] = values
        by_dna[dna] = digest
    revision = hashlib.sha256(json.dumps(by_dna, sort_keys=True).encode()).hexdigest()
    return dict(version=1, mode='authored-overrides', sourceRevision=revision, byDNA=by_dna, profiles=profiles)


def select_appearances(appearance, dnas, required=False):
    if not appearance: return None
    if appearance.get('version') != 1: raise ValueError('Unsupported fitting appearance version')
    selected = {}
    profiles = {}
    for dna in sorted(set(dnas)):
        key = appearance.get('byDNA', {}).get(dna)
        if key is None:
            if required: raise ValueError('Missing fitting appearance for ' + dna)
            continue
        parameters = appearance.get('profiles', {}).get(key)
        profiles[key] = validate_parameters(parameters, sparse=True)
        selected[dna] = key
    return dict(version=1, mode='authored-overrides', sourceRevision=appearance.get('sourceRevision'), byDNA=selected, profiles=profiles)
