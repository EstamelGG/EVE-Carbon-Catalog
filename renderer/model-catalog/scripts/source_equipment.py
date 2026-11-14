"""Read authored turret sets and shader bindings from checksum-verified BLACK files.

CCP Trinity (MIT), EveTurretSet_Blue.cpp and Shader/Tr2Effect.h.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/Turret/EveTurretSet_Blue.cpp#L48-L130
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Shader/Tr2Effect.h#L41-L50
"""
from black_projection import BlackProjection
from source_background_scene import BACKGROUND_SCHEMAS
from sof_texture_schema import fields


PARAMETERS = ['Mtl%d%s' % (i, suffix) for i in range(1, 5)
              for suffix in ('DiffuseColor', 'FresnelColor', 'Gloss', 'DustDiffuseColor')] + ['GeneralGlowColor']
TURRET = fields(string='name locatorName geometryResPath firingEffectResPath',
    wstring='idleToTargetingMovementAudioEvent targetingToIdleMovementAudioEvent',
    I='state impactBehaviour maxCyclingFirePos cyclingFireGroupCount',
    B='display updatePitchPose useDynamicBounds useRandomFiringDelay useLowLodFiringTransform '
      'laserMissBehaviour projectileMissBehaviour chooseRandomLocator randomizeExplosionRotation',
    f='bottomClipHeight maxTrackingTime impactSize sysBoneHeight sysBonePitchFactor sysBonePitchOffset '
      'sysBonePitchMin sysBonePitchMax sysBonePitch01Factor sysBonePitch01Offset sysBonePitch02Factor '
      'sysBonePitch02Offset sysBonePitch03Factor sysBonePitch03Offset',
    record='turretEffect', object='turretMovementObserver firingEffect ambientEffect',
    **{'4f': 'boundingSphere lowLodFiringEffectRotation',
       '3f': 'lowLodFiringEffectScale lowLodFiringEffectTranslation'})


class EquipmentProjection(BlackProjection):
    def field(self, kind):
        if kind not in ('constant_list', 'option_list'):
            return super().field(kind)
        # BlackWriter::PatchStringsInStructureList clears the shared-string
        # pointer and stores a uint16 table index in its first two bytes.
        # https://github.com/carbonengine/blue/blob/d9d67648e0ffaae397e6399b3e072e05c2380080/src/BlackWriter.cpp#L256-L284
        count, stride = self.value('IH')
        constant = kind == 'constant_list'
        width = stride - 16 if constant else stride // 2
        if width not in (4, 8) or stride != (width + 16 if constant else 2 * width):
            raise ValueError('Unsupported BLACK effect structure stride: %d' % stride)
        result = {}
        for _ in range(count):
            key = self.string()
            self.take(width - 2)
            if constant:
                result[key] = list(self.value('4f'))
            else:
                result[key] = self.string()
                self.take(width - 2)
        return result


EFFECT_SCHEMAS = dict(BACKGROUND_SCHEMAS, Tr2Effect=dict(
    BACKGROUND_SCHEMAS['Tr2Effect'], constParameters='constant_list',
    options='option_list', samplerOverrides='structures'))


def read_equipment(resources, path):
    return EquipmentProjection(resources.read(path), EFFECT_SCHEMAS).root('EveTurretSet', TURRET)


def effect_inputs(effect):
    parameters = dict(effect.get('constParameters', {}))
    parameters.update((p['name'], p['value']) for p in effect.get('parameters', []))
    return dict(effect=effect['effectFilePath'], parameters=parameters,
                options=list(effect.get('options', {}).items()),
                textures={t['name']: t['resourcePath'] for t in effect.get('resources', [])})


def equipment_metadata(resources, sources):
    """Build fitting rows for SDE aliases from their shared weapon file."""
    records = {}
    for path in set(sources.values()):
        turret = resources.equipment(path)
        effect = turret.get('turretEffect')
        if not effect:
            raise ValueError('Equipment has no drawable turret material: ' + path)
        parameters = effect_inputs(effect)['parameters']
        records[path] = dict(locatorName=turret.get('locatorName') or 'locator_turret_', graphicFile=path,
                             authoredParameters={name: parameters[name] for name in PARAMETERS})
    return {key: records[path] for key, path in sources.items()}


def apply_equipment_surface(hull, graphic, resources):
    from fitting_materials import turret_lookup
    from sof_parameters import SurfaceParameters
    from sof_resources import UnsupportedSofDNA
    from sof_texture_schema import AREA_TYPES
    turret = resources.equipment(graphic['graphicFile'])
    effect = turret.get('turretEffect')
    if not effect:
        raise ValueError('Equipment has no drawable turret material: ' + graphic['graphicFile'])
    area = effect_inputs(effect)
    if area['effect'].lower().split('/')[-1] not in ('quadv5.fx', 'skinned_quadv5.fx'):
        raise ValueError('Unsupported equipment material: ' + area['effect'])
    faction_name = graphic.get('sofFactionName')
    if faction_name:
        try:
            faction = resources.named('factions', faction_name.lower(), 'Faction')
        except UnsupportedSofDNA:
            faction = None  # SetupTurretMaterialFromFaction returns when lookup fails.
        if faction is not None:
            generic = resources.generic
            area_type = AREA_TYPES[generic.get('turretAreaType', 0)]
            surface = SurfaceParameters(resources, {}, {}, faction, {})
            # ApplyFactionToTurretShader updates constants first. Explicit
            # parameter objects keep their later binding when both are present.
            explicit = {p['name'] for p in effect.get('parameters', [])}
            names = set(effect['constParameters']) - explicit if effect.get('constParameters') else explicit
            for name in names:
                lookup = turret_lookup(generic, faction, name)
                assigned = surface.parameter({}, area_type, lookup)
                if assigned is not None:
                    area['parameters'][name] = assigned
    hull.update(geometry=turret['geometryResPath'], meshIndex='primary',
                areas=[dict(area, kind='opaqueAreas', name='Turret', index=0, count=1)])
    preview = hull['equipment']
    preview['locatorName'] = turret.get('locatorName') or 'locator_turret_'
