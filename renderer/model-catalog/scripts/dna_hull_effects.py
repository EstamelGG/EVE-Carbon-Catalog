"""Blender step for DNA-selected root hull lights, luminous planes, exhaust, decals, static child meshes and CPU particles."""
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from effect_assets import pack_effects
from effect_supplements import omit_empty_decals, pack_supplements
from effect_planes import pack_planes
from sof_attachments import attachment_definitions
from sof_decals import decal_inputs
from sof_geometry import geometry_for_dna
from sof_planes import plane_sets
from source_child_meshes import static_mesh_roots
from source_hull_particles import pack_hull_particles
from supplement_assets import SupplementAssets
from sof_resources import SofResources


def assemble_effects(dna, cache, work, output):
    assets = SupplementAssets(cache, {}, dist=output, receipts=work / 'effect-receipts')
    sof = SofResources(cache, assets.index)
    # The standard packer can resolve authored light clusters directly for
    # a DNA hull. This input supplies no serialized scene or client records.
    effects = pack_effects(dict(dna=dna, typeID=None), assets, sof, item={'dna': dna})
    definitions = attachment_definitions(sof, dna)
    planes = plane_sets(*definitions)
    effects['planeGlow'] = pack_planes({'sofPlanes': planes}, assets)
    geometry = geometry_for_dna(sof, dna)
    decals = decal_inputs(sof, definitions, geometry, dna)
    children = static_mesh_roots(sof, definitions)
    if decals or children:
        supplements = pack_supplements(dict(geometry=geometry, children=children, decals=decals), assets,
                                       effects['lighting'], sof.material_options)
        omit_empty_decals(supplements)
        effects['supplements'] = supplements
    scene, particle_issues = pack_hull_particles(sof, definitions, assets)
    if scene:
        effects['scene'] = scene
    return dict(payload=effects, particleEmitters=len(scene['particles']) if scene else 0,
                particleIssues=particle_issues,
                effectSOFInputs=list(sof.used.values()),
                effectTextureInputs=[v['recipe'] for v in assets.resources.values()],
                effectMeshInputs=[dict(resource=m['resource'], checksum=m['checksum']) for m in assets.meshes.values()])


if __name__ == '__main__':
    config_path = Path(sys.argv[sys.argv.index('--') + 1])
    config = json.loads(config_path.read_bytes())
    addon = Path(config['addon'])
    sys.path[:0] = [str(addon / 'addons'), *(str(p) for p in (addon / 'packages').glob('*/src'))]
    work = Path(config['output'])
    result = assemble_effects(config['dna'], Path(config['cache']), work, Path(config['publishRoot']))
    (work / 'dna-effects.json').write_text(json.dumps(result), encoding='utf8')
