"""Publish a DNA-selected SOF hull, GR2 animation clips and authored attachments for dna-direct.html.

Example: py -3 model-catalog/scripts/build_dna_hull.py af1_t1:sarum:amarr --cache E:/EVE/SharedCache

Reads local SOF BLACK, GR2 and DDS files. Publishes source-material glTF previews and portable GLB downloads for bakeable hulls.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import struct
import sys
import tempfile

CATALOG = Path(__file__).resolve().parents[1]
EXPORTER = CATALOG.parent / 'tools/model_export'
sys.path.insert(0, str(EXPORTER))

from cache_lock import file_lock
from core import VERSION, collect_sources, read_json, write_json
from glb import HULL_GEOMETRY_REVISION
from package import find_blender, preferences
from pipeline_common import atomic_bytes, publish
from sof_geometry import geometry_for_dna
from sof_resources import SofResources
from sof_textures import authored_hull_surface


MANIFEST_VERSION = 2
HULL_EFFECTS_REVISION = 4
HULL_MATERIAL_REVISION = 1


def manifest_path(output, dna):
    key = sha256(dna.strip().lower().encode('utf-8')).hexdigest()
    return output / 'data/dna-hulls' / (key + '.json')


def write_manifest(path, record, *, expected=None):
    lock = path.parents[3]/'.work/dna-manifest-locks'/(path.stem+'.lock')
    with file_lock(lock):
        if expected is not None and (not path.is_file() or path.read_bytes() != expected):
            return False
        content = (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode('utf8')
        atomic_bytes(path, content)
        return True


def clip_names(document):
    # Match the identifiers exposed by Three.GLTFLoader for unnamed glTF animations.
    return [animation.get('name') or f'animation_{i}' for i, animation in enumerate(document.get('animations', []))]


def publish_effect_metadata(output, payload, clips):
    payload['animation']['isAnimated'] = bool(clips)
    content = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    effect_file = publish(output, 'dna-hulls', content, 'json')
    return dict(version=MANIFEST_VERSION, clips=clips, effects=effect_file['url'], effectsSHA256=effect_file['contentHash'])


def upgrade_clip_metadata(output, path, record):
    from build_catalog import glb_parts

    model = output / record['model']
    document = read_json(model) if model.suffix == '.gltf' else glb_parts(model)[0]
    payload = read_json(output / record['effects'])
    record.update(publish_effect_metadata(output, payload, clip_names(document)))
    write_manifest(path, record)
    return record


def publish_hull(output, work, glb, portable, palette):
    from gltf_geometry_buffer import geometry_buffer
    from build_catalog import glb_parts
    from source_materials import attach_source_materials

    document, vertices = glb_parts(glb)
    clips = clip_names(document)
    document.setdefault('extras', {}).setdefault('ccpdec', {})['bonePalette'] = palette
    download = {}
    if portable:
        # GLB 2.0: JSON uses space padding and the source BIN is already aligned.
        # https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-gltf-layout
        header = json.dumps(document, separators=(',', ':')).encode('utf8')
        header += b' ' * (-len(header) % 4)
        chunks = struct.pack('<I4s', len(header), b'JSON') + header + struct.pack('<I4s', len(vertices), b'BIN\0') + vertices
        blob = struct.pack('<4sII', b'glTF', 2, 12 + len(chunks)) + chunks
        download['portableModel'] = publish(output, 'dna-hulls', blob, 'glb')['url']
    vertices = geometry_buffer(document, vertices)
    buffer = publish(output, 'dna-hulls', vertices, 'bin')
    document['buffers'] = [dict(uri=Path(buffer['url']).name, byteLength=len(vertices))]
    attach_source_materials(document, work, {}, dist=output)
    return publish(output, 'dna-hulls', json.dumps(document, separators=(',', ':')).encode('utf-8'), 'gltf'), clips, download


def publish_preview(cache, output, dna):
    from reflection_assets import publish_scene_cubes
    from source_preview_lighting import build_preview
    from source_preview_scene import read_preview_scenes, PREVIEW_SUN_COLOR, PREVIEW_DIFFUSE_INTENSITY
    from source_resources import SourceResources

    resources = SourceResources(cache)
    settings = build_preview(resources)
    race = dna.split(':')[2]
    scene = read_preview_scenes(resources, [race])[race]
    settings['environment'] = dict(source=publish_scene_cubes(resources, output, scene),
                                   sunColor=PREVIEW_SUN_COLOR, diffuseIntensity=PREVIEW_DIFFUSE_INTENSITY)
    settings['provenance']['inputs'] = list(resources.used.values())
    content = json.dumps(settings, separators=(',', ':'), ensure_ascii=False).encode('utf8')
    return publish(output, 'lighting', content, 'json')['url']


def build(dna, cache, blender, addon, output):
    dna = dna.strip().lower()
    resources = SofResources(cache)
    if not resources.index:
        raise ValueError(f'No SharedCache resource index in {cache}')
    surface = authored_hull_surface(resources, dna)
    if surface is None:
        raise ValueError(f'No supported, locally available SOF surface for {dna}')
    geometry = geometry_for_dna(resources, dna)
    hull = dict(dna=dna, geometry=geometry, meshIndex=0, **surface)
    from surface_passes import split_surface_passes
    use_patterns = bool(surface.get('customMasks'))
    _, overlays = split_surface_passes(surface['areas'])
    runtime_export = bool(use_patterns or overlays)
    if surface.get('overlayRadius'):
        hull['sourceRadius'] = surface['overlayRadius']
    with tempfile.TemporaryDirectory(prefix='dna-hull-') as staging:
        work = Path(staging)
        sources = collect_sources(hull, work, cache=cache, resource_index=resources.index)
        config = dict(version=VERSION, name='hull', output=str(work), addon=str(addon.resolve()),
                      dna=dna, cache=str(cache.resolve()), publishRoot=str(output.resolve()),
                      formats=['glb'], metalrough_only=True, runtime_materials=runtime_export, animated=True, preview=False)
        config_file = work / 'blender-input.json'
        write_json(config_file, config)
        subprocess.run([str(blender), '--background', '--factory-startup', '--disable-autoexec',
                        '--python-exit-code', '1', '--python', str(EXPORTER / 'blender_export.py'),
                        '--python', str(CATALOG / 'scripts/dna_hull_effects.py'),
                        '--', str(config_file)], check=True)
        report = read_json(work / 'conversion-report.json')
        glb = work / 'converted/hull-metalrough.glb'
        model, clips, download = publish_hull(output, work, glb, not runtime_export, report.get('bonePalette', []))
        effect_inputs = read_json(work / 'dna-effects.json')
        metadata = publish_effect_metadata(output, effect_inputs.pop('payload'), clips)
    record = dict(dna=dna, preview=publish_preview(cache, output, dna), profile='projected-hull' if use_patterns else 'sof-hull', materialRevision=HULL_MATERIAL_REVISION,
                  **download,
                  **effect_inputs, **metadata, effectsRevision=HULL_EFFECTS_REVISION,
                  model=model['url'], modelSHA256=model['contentHash'], geometryRevision=HULL_GEOMETRY_REVISION,
                  geometry=geometry, vertices=report['vertices'], triangles=report['triangles'],
                  areas=[{key: a[key] for key in ('name', 'index', 'count', 'effect')} for a in surface['areas']],
                  blender=report['blender'], warnings=report['warnings'], sofInputs=list(resources.used.values()),
                  meshAndTextureInputs=[{key: item[key] for key in ('resource', 'bytes', 'md5')} for item in sources])
    manifest = manifest_path(output, dna)
    write_manifest(manifest, record)
    return manifest


def upgrade_hull_effects(record, path, cache, blender, addon, output):
    # Reuse the deployed geometry and clip names when only the attachment pack changes.
    with tempfile.TemporaryDirectory(prefix='dna-effects-') as staging:
        work = Path(staging)
        config = work / 'effects-input.json'
        write_json(config, dict(dna=record['dna'], cache=str(cache.resolve()), output=str(work),
                                addon=str(addon.resolve()), publishRoot=str(output.resolve())))
        subprocess.run([str(blender), '--background', '--factory-startup', '--disable-autoexec',
                        '--python-exit-code', '1', '--python', str(CATALOG / 'scripts/dna_hull_effects.py'),
                        '--', str(config)], check=True)
        inputs = read_json(work / 'dna-effects.json')
        metadata = publish_effect_metadata(output, inputs.pop('payload'), record['clips'])
        record.update(inputs, **metadata, effectsRevision=HULL_EFFECTS_REVISION)
        write_manifest(path, record)
    return path


def ensure_hull(dna, cache, blender, addon, output, *, rebuild=False):
    path = manifest_path(output, dna)
    if path.is_file() and not rebuild:
        record = read_json(path)
        if (record.get('geometryRevision', 0) >= HULL_GEOMETRY_REVISION
                and all(record.get(field) and (output / record[field]).is_file() for field in ('model', 'effects'))):
            if cache and record.get('profile') == 'static-portable-pbr' and record.get('materialRevision', 0) < HULL_MATERIAL_REVISION:
                return build(dna, cache, blender or find_blender(), addon, output)
            if record.get('version', 0) < MANIFEST_VERSION:
                upgrade_clip_metadata(output, path, record)
            if cache and record.get('effectsRevision', 0) < HULL_EFFECTS_REVISION:
                upgrade_hull_effects(record, path, cache, blender or find_blender(), addon, output)
            if cache and not record.get('preview'):
                preview = publish_preview(cache, output, dna.strip().lower())
                # Another CLI or the geometry migrator may have updated the same hull.
                while True:
                    original = path.read_bytes()
                    latest = json.loads(original)
                    if latest.get('preview') or write_manifest(path, dict(latest, preview=preview), expected=original):
                        break
            return path
    if not cache:
        raise ValueError('Supply --cache or set EVE_SHARED_CACHE')
    return build(dna, cache, blender or find_blender(), addon, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('dna', help='hull:faction:race, with optional SOF surface commands')
    parser.add_argument('--cache', type=Path, help='EVE SharedCache (or set EVE_SHARED_CACHE)')
    parser.add_argument('--blender', type=Path, help='Blender executable (default: auto-detect)')
    parser.add_argument('--addon', type=Path, default=EXPORTER / '.deps/tools-blender',
                        help='Installed carbonenginejs/tools-blender checkout')
    parser.add_argument('--output', type=Path, default=CATALOG / 'dist',
                        help='Directory for assets/dna-hulls and data/dna-hulls')
    parser.add_argument('--rebuild', action='store_true', help='Read source assets again even when the cached hull is current')
    args = parser.parse_args()
    cache = args.cache or preferences().get('eve_shared_cache_root')
    if cache:
        cache = Path(cache)
    try:
        print(ensure_hull(args.dna, cache, args.blender, args.addon, args.output, rebuild=args.rebuild))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'{parser.prog}: {error}\n')


if __name__ == '__main__':
    main()
