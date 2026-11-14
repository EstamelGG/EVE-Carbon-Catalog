"""Publish SOF hull decals into an existing room without rebuilding its scene FX.

Run with Blender --background --python-exit-code 1 --python this_script -- CACHE PUBLICATION ROOM --addon TOOLS_BLENDER.
Source selection and projection follow Trinity EveSOF::SetupDecalSets (see sof_decals).
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from effect_supplements import omit_empty_decals, pack_supplements
from pipeline_common import atomic_bytes
from shared_effect_geometry import publish_catalog_effects
from sof_attachments import attachment_definitions
from sof_decals import decal_inputs
from sof_geometry import geometry_for_dna
from sof_resources import SofResources
from supplement_assets import SupplementAssets


def publish_room(cache, publication, key):
    path = publication / 'data/hangars.json'
    original = path.read_bytes()
    manifest = json.loads(original)
    room = next(entry for entry in manifest['hangars'] if entry['key'] == key)
    effects = json.loads((publication / room['effects']).read_bytes())
    assets = SupplementAssets(cache, {}, dist=publication)
    sof = SofResources(cache, assets.index)
    geometry = geometry_for_dna(sof, room['dna'])
    definitions = attachment_definitions(sof, room['dna'])
    inputs = decal_inputs(sof, definitions, geometry, room['dna'])
    packed = pack_supplements(dict(geometry=geometry, children=[], decals=inputs), assets)
    if packed['unsupported']:
        raise ValueError(packed['unsupported'])
    omit_empty_decals(packed)
    supplements = effects.setdefault('supplements', packed)
    supplements['decals'] = packed['decals']
    supplements['unsupported'] = [item for item in supplements['unsupported']
                                  if not str(item.get('node', '')).startswith('decal:')]
    published = publish_catalog_effects(publication, effects, {})
    if any(room.get(k) != v for k, v in published.items()):
        if path.read_bytes() != original:
            raise RuntimeError('Room manifest changed while building decals. Rerun the publisher.')
        room.update(published)
        atomic_bytes(path, json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).encode('utf8'))
    print(f"{key}: {len(packed['decals'])}/{len(inputs)} intersect the mesh; {room['effects']}", flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('publication', type=Path)
    parser.add_argument('room')
    parser.add_argument('--addon', required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    sys.path[:0] = [str(p) for p in (args.addon / 'packages').glob('*/src')]
    publish_room(args.cache.resolve(), args.publication.resolve(), args.room)
