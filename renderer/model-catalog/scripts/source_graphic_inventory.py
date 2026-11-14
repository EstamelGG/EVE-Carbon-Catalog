"""Read mesh paths along the same object properties as the catalog inventory."""
from struct import pack, unpack_from

from black_projection import BlackProjection
from sof_texture_schema import fields
from source_light_rig import LIGHT_RIG_SCHEMAS


# Blue field types from CCP Trinity f644516a (MIT), EveEffectRoot2_Blue.cpp,
# EveTransform_Blue.cpp, Tr2Transform_Blue.cpp, and the mesh/child declarations:
# https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity
# Only mesh and child edges contribute geometry. Other typed records may
# define references that these edges use later in the stream.
ROOT = fields(string='name', records='effectChildren', objects='observers lights externalParameters curveSets controllers',
              object='translationCurve rotationCurve modelTranslationCurve modelRotationCurve',
              f='boundingSphereRadius duration secondaryLightingSphereRadius',
              **{'?': 'display dynamicLOD', '3f': 'boundingSphereCenter translation scaling', '4f': 'rotation secondaryLightingEmissiveColor'})
TRANSFORM = fields(string='name', records='children', record='mesh', objects='particleEmitters particleSystems observers curveSets',
                   object='meshLod', f='visibilityThreshold boundingSphereRadius sortValueMultiplier', I='modifier',
                   **{'?': 'display hideOnLowQuality useLodLevel', '3f': 'translation scaling overrideBoundsMin overrideBoundsMax',
                      '4f': 'rotation', '16f': 'localTransform'})
CHILD = fields(string='name', objects='transformModifiers curveSets controllers lights attachments',
               object='inheritProperties', I='displayFilter reflectionMode', f='minScreenSize lodSphereRadius',
               **{'?': 'display updateOnDisplay useSRT staticTransform useStaticRotation useStaticScale useDynamicLod',
                  '3f': 'translation scaling', '4f': 'rotation', '16f': 'localTransform'})
MESH = fields(string='name geometryResPath', i='meshIndex', f='maxVertexScale maxVertexDisplacement',
              **{'?': 'display deferGeometryLoad rotatesVertices'}, objects='opaqueAreas decalAreas depthAreas transparentAreas '
              'additiveAreas distortionAreas pickableAreas mirrorAreas decalNormalAreas depthNormalAreas '
              'opaquePrepassAreas decalPrepassAreas geometryEraserAreas serializedMorphAnimations')
CONTAINER = dict(CHILD, objects='records', observers='objects', fxAttributes='objects', alwaysOn='?')
CHILD_MESH = dict(CHILD, mesh='record', sortValueOffset='f', sortValueScale='f', lowestLodVisible='I')
SCHEMAS = dict(EveStation2=fields(string='name', record='mesh', records='effectChildren children'),
               EveLensflare=fields(string='name', record='mesh', object='translationCurve',
                                   objects='flares occluders backgroundOccluders distanceToEdgeCurves distanceToCenterCurves '
                                           'radialAngleCurves xDistanceToCenter yDistanceToCenter bindings curveSets controllers',
                                   f='cameraFactor', **{'3f': 'position', '?': 'display update'}),
               EveStretch={},
               EveEffectRoot2=ROOT, EvePlanet=dict(ROOT, radius='f', estimatedPixelDiameter='f', minScreenSize='f',
                                                  albedoColor='4f', emissiveColor='4f', zOnlyModel='object'),
               EveRootTransform=dict(TRANSFORM, translationCurve='object', rotationCurve='object',
                                     modelTranslationCurve='object', modelRotationCurve='object'),
               EveTransform=TRANSFORM, EveChildContainer=CONTAINER, EveChildMesh=CHILD_MESH,
               EveChildEffectPropagator=dict(CONTAINER, **fields(object='effect triggerSphereRadiusCurve localLocators',
                    string='locatorSetName', I='propagationType triggerMethood', q='numTriggers',
                    f='playTime triggerSphereScalarMulti completeness randScaleMin randScaleMax stopToClearDelay '
                      'range minRangeThreshold ClosenessPreference frequency durationPerEffect stopAfterNumTriggers',
                    **{'3f':'triggerSphereOffset effectScaling', '?':'trigger isPlaying skipCleanup replayAfterDelay'})),
               EveChildSpherePin=dict(CHILD_MESH, **fields(f='pinRadius pinMaxRadius pinRotation pinAlphaThreshold',
                                                           **{'3f':'centerNormal', '4f':'color pinColor'})),
               EveChildLineSet=dict(CHILD, mesh='record', renderType='I', lineSet='object', lines='objects', alwaysOn='?', additiveBatches='?',
                                    scrollSpeed='f', brightness='f', baseColor='4f', animColor='4f'),
               EveChildParticleSphere=fields(string='name', record='mesh', object='particleSystem', objects='generators',
                    f='radius egoSpeed movementScale maxSpeed positionShift positionShiftMax positionShiftMin '
                      'positionShiftIncreaseSpeed positionShiftDecreaseSpeed', **{'?':'display useSpaceObjectData'}),
               EveChildParticleSystem=dict(CHILD, mesh='record', particleEmitters='objects', particleSystems='objects'),
               Tr2Mesh=MESH, Tr2InstancedMesh=dict(MESH, instanceGeometryResPath='string', instanceGeometryResource='object',
                                                   instanceMeshIndex='I', boundsMethod='I', minBounds='3f', maxBounds='3f',
                                                   maxInstanceSize='f'))

# These records do not contribute geometry. Reading their declared properties
# registers actual object definitions referenced again later in the same file.
INDEX_SCHEMAS = dict(
    EveChildCloud2=fields(string='name', object='effect reflectionEffect lightmap animation shadowMapDS', objects='lights',
        I='minVisibleQuality noiseTextureSize reflectionMode', f='sortingModifier lightmapSizeScale minScreenSize',
        **{'3f':'translation scaling textureTiling detailTiling1 detailTiling2', '4f':'rotation',
           '?':'display castShadows receiveShadows lightmapDirty'}),
    Tr2CurveScalar=LIGHT_RIG_SCHEMAS['Tr2CurveScalar'],
    Tr2CurveScalarExpression=dict(LIGHT_RIG_SCHEMAS['Tr2CurveScalarExpression'], inputs='objects'),
    Tr2MeshArea=fields(string='name', object='effect', I='index count', **{'?':'display reversed'}),
    Tr2Effect=fields(string='name effectFilePath', objects='resources parameters', structures='constParameters options samplerOverrides'),
    Tr2DynamicEmitter=fields(string='name', objects='generators', object='particleSystem', f='rate', i='maxParticles'),
    Tr2StaticEmitter=fields(string='name geometryResourcePath', object='particleSystem', I='geometryIndex'),
    Tr2ParticleSystem=fields(string='name', objects='elements forces constraints',
        object='emitParticleOnDeathEmitter emitParticleDuringLifeEmitter', I='maxParticleCount',
        **{'?':'requiresSorting updateSimulation applyForce applyAging isGlobal useSimTimeRebase'}),
    TriCurveSet=fields(string='name', objects='curves bindings ranges', object='driver', f='scale', **{'?':'playOnLoad'}))


class InventoryProjection(BlackProjection):
    def __init__(self, content, schemas, index_nested=False):
        super().__init__(content, {**schemas, **INDEX_SCHEMAS} if index_nested else schemas)
        self.index_nested = index_nested
        self.skipped = []
        self.record_end = len(content)

    def object_bounds(self, *, ignored=False):
        position = self.offset
        ref = self.value('I')
        if ignored and ref and ref not in self.references:
            # BlackWriter assigns IDs at the first definition in stream order.
            # A lower ID following a higher definition can only be a reference.
            if any(known > ref and start - 8 < position for known, (start, _) in self.references.items()):
                return None
        self.offset = position
        if ref and ref not in self.references:
            # The first definition may be inside an opaque effect/controller.
            # If those bytes could contain its ID, leave the graph to the full
            # reader instead of treating a backreference as a new object size.
            token = pack('<I', ref)
            for start, end in self.skipped:
                end = min(end, position)
                candidate = self.content.find(token, start, end)
                while candidate >= 0 and candidate + 10 <= end:
                    size, type_index = unpack_from('<IH', self.content, candidate + 4)
                    if 2 <= size <= end - candidate - 8 and type_index < len(self.strings):
                        # A later reference occupies exactly four bytes. If a
                        # definition cannot fit in the containing record here,
                        # an ignored edge can be consumed without its target.
                        if ignored and not self.definition_fits(position):
                            self.offset = position + 4
                            return None
                        raise ValueError('Unresolved BLACK reference across an opaque field')
                    candidate = self.content.find(token, candidate + 1, end)
            if not self.definition_fits(position):
                raise ValueError('BLACK object definition outside containing record')
        return super().object_bounds()

    def definition_fits(self, position):
        if position + 10 > self.record_end:
            return False
        size, type_index = unpack_from('<IH', self.content, position + 4)
        return 2 <= size <= self.record_end - position - 8 and type_index < len(self.strings)

    def class_at(self, bounds):
        resume = self.offset
        self.offset = bounds[0]
        kind = self.string()
        self.offset = resume
        return kind

    def field(self, kind):
        if kind not in ('object', 'objects'):
            return super().field(kind)
        for _ in range(1 if kind == 'object' else self.value('I')):
            bounds = self.object_bounds(ignored=True)
            if bounds:
                if self.index_nested and self.class_at(bounds) in self.schemas:
                    self.record_at(bounds)
                else:
                    self.skipped.append(bounds)

    def record_at(self, bounds, expected_type=None, required_fields=None):
        if bounds:
            kind = self.class_at(bounds)
            # These CCP classes expose none of the ten inventory properties,
            # including on their published base types. Their effects can contain
            # other GR2 strings that are intentionally outside the object walk.
            if kind in ('EveChildCloud2', 'EveChildCloud', 'EveChildQuad', 'EveChildPostProcessVolume', 'EveStretch'):
                if not (self.index_nested and kind in INDEX_SCHEMAS):
                    self.skipped.append(bounds)
                    return {}
            if not self.index_nested and kind in ('Tr2Mesh', 'Tr2InstancedMesh'):
                required_fields = {'geometryResPath'}
        containing_end = self.record_end
        if bounds:
            self.record_end = bounds[1]
        try:
            result = super().record_at(bounds, expected_type, required_fields)
        finally:
            self.record_end = containing_end
        if bounds and required_fields:
            self.skipped.append(bounds)
        return result


def graphic_mesh_paths(content):
    """Return None for unsupported graphs, including a single unknown reachable object."""
    for index_nested in (False, True):
        reader = InventoryProjection(content, SCHEMAS, index_nested)
        root = reader.root_type()
        if root not in SCHEMAS:
            return None
        try:
            graph = reader.root(root, SCHEMAS[root])
            break
        except ValueError:
            continue
    else:
        return None
    found, seen = set(), set()
    pending = [graph]
    while pending:
        node = pending.pop()
        if not node or id(node) in seen:
            continue
        seen.add(id(node))
        for field in ('geometryResPath', 'geometryResFilePath'):
            path = node.get(field, '')
            if path.lower().endswith('.gr2'):
                found.add(path.lower())
        for field in ('mesh', 'meshes', 'children', 'objects', 'effectChildren',
                      'highDetailMesh', 'mediumDetailMesh', 'lowDetailMesh'):
            value = node.get(field)
            if value:
                pending.extend(value if isinstance(value, list) else [value])
    return sorted(found)
