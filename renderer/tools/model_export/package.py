"""One typeID in, one verified GLB/OBJ/resource ZIP out."""
import argparse
from datetime import datetime
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from core import read_json, write_json
from sde import resolve_type
from geometry import create_geometry_zip, verified_zip


def find_blender():
    command = shutil.which('blender')
    if command:
        return Path(command)
    candidates = list((Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Blender Foundation').glob('Blender */blender.exe'))
    if candidates:
        return max(candidates, key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p.parent.name)))
    raise ValueError('Blender not found; provide --blender')


def preferences():
    """Read only this project's settings; never consult another application's config."""
    path = Path(__file__).resolve().parents[2] / 'settings.local.json'
    settings = read_json(path) if path.is_file() else {}
    if os.environ.get('EVE_SHARED_CACHE'):
        settings['eve_shared_cache_root'] = os.environ['EVE_SHARED_CACHE']
    return settings


def create_zip(folder, target, metadata):
    """Only allowlisted deliverables; no machine paths, launch requests or logs."""
    report = read_json(folder / 'conversion-report.json')
    if read_json(folder / 'status.json')['status'] != 'complete':
        raise ValueError('Cannot package an incomplete export')
    name = metadata['slug']
    if report.get('geometry_only'):
        return create_geometry_zip(folder, target, metadata)
    for extension in ('.glb', '-metalrough.glb', '.obj', '.mtl', '.blend', '-native.blend'):
        if not (folder / 'converted' / (name + extension)).is_file():
            raise ValueError('Missing requested deliverable: ' + name + extension)
    write_json(folder / 'model.json', metadata)
    text = ('# %s — typeID %s\n\n' % (metadata['name'].get('en', name), metadata['typeID'])
            + 'DNA: `%s`\n\n' % metadata['dna']
            + '## Files\n\n'
            + '- `converted/*.glb`: portable static hull; primary uses KHR_materials_specular.\n'
            + '- `converted/*-metalrough.glb`: approximate core metallic/roughness compatibility variant.\n'
            + '- `converted/*.obj` + `.mtl`: legacy mesh/material interchange; keep `textures/` alongside it.\n'
            + '- `converted/*.blend`: packed editable portable scene; `*-native.blend` keeps source shader nodes.\n'
            + '- `raw/`: verified original resources, including complete DDS files and their mip chains.\n'
            + '- `source-textures/`: decoded 2D DDS top mip as RGBA PNG, identical width/height.\n'
            + '- `textures/`: derived PBR maps, plus DirectX normals for manual texture import. GLB uses OpenGL normals.\n'
            + '- `default-materials.json`: source parameters and logical resource references.\n'
            + '- `conversion-report.json`: source/generated/embedded dimensions, UV checks and limitations.\n'
            + '- `package-manifest.json`: SHA-256 and size of every packaged file except this manifest itself.\n\n'
            + '## Resolution\n\nOriginal UV0 and tiling are retained. No whole-hull unwrap or atlas bake. '
            + 'Normals retain their own source dimensions. Composites use the maximum width and height of their contributing maps; '
            + 'they are not necessarily the same size as any one source. Sail composites use an additional local UV with at least original texel density. '
            + 'Original DDS bytes are authoritative; decoded PNGs are 8-bit. Runtime mipmaps, filtering, shader differences and lighting can still affect appearance.\n\n'
            + '## Limitations\n\n' + '\n'.join('- ' + w for w in report['warnings'])
            + '\n\nStatic hull export only. Game assets retain their original ownership; this archive does not grant redistribution rights.\n')
    (folder / 'README.md').write_text(text, encoding='utf-8')
    files = []
    for directory in ('converted', 'raw', 'source-textures', 'textures'):
        files.extend(p for p in (folder / directory).rglob('*') if p.is_file() and not p.name.endswith('.blend1'))
    files.extend(folder / filename for filename in ('README.md', 'model.json', 'default-materials.json', 'source-manifest.json', 'conversion-report.json'))
    if (folder / 'preview.png').exists():
        files.append(folder / 'preview.png')
    return verified_zip(folder, target, files, type_id=metadata['typeID'])


def main():
    here = Path(__file__).resolve().parent
    repo = here.parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('type_id', type=int)
    parser.add_argument('--sde', type=Path, default=repo / 'decode_output/sde')
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--service')
    parser.add_argument('--blender', type=Path)
    parser.add_argument('--output', type=Path, help='ZIP filename; default exports/<name>-<typeID>-<timestamp>.zip')
    parser.add_argument('--source', type=Path, help='Optional offline material/resource capture; must match the SDE default DNA')
    parser.add_argument('--allow-approximate', action='store_true')
    parser.add_argument('--preview', action='store_true')
    parser.add_argument('--geometry-only', action='store_true')
    args = parser.parse_args()
    metadata = resolve_type(args.sde, args.type_id)
    print('Resolved typeID %d: %s [%s]' % (args.type_id, metadata['name'].get('en'), metadata['dna']), flush=True)
    prefs = preferences()
    cache = args.cache or prefs.get('eve_shared_cache_root') or os.environ.get('EVE_ROOT')
    service = args.service or prefs.get('eve_client_service') or 'tq'
    blender = args.blender or find_blender()
    if not blender.is_file():
        parser.error('Blender executable not found')
    if not cache and not args.source:
        parser.error('Set eve_shared_cache_root in settings.local.json or pass --cache')
    output = (args.output or repo / 'exports' / ('%s-%s-%s.zip' % (metadata['slug'], args.type_id, datetime.now().strftime('%Y%m%d-%H%M%S')))).resolve()
    if output.suffix.lower() != '.zip':
        parser.error('--output must end in .zip')
    if output.exists():
        raise FileExistsError(output)
    folder = output.with_name(output.stem + '-files')
    if folder.exists():
        raise FileExistsError('Export working directory already exists: ' + str(folder))
    if args.source:
        captured = read_json(args.source / 'default-materials.json')
        if captured.get('dna') != metadata['dna'] or captured.get('typeID', args.type_id) != args.type_id:
            raise ValueError('Source capture does not match requested typeID/default DNA')
    if not (here / '.deps/tools-blender/ccpdec-dependency.json').exists():
        print('Installing pinned importer dependency...', flush=True)
        subprocess.run([sys.executable, str(here / 'setup_dependency.py')], check=True)
    command = [sys.executable, str(here / 'export.py'), '--type-id', str(args.type_id), '--name', metadata['slug'],
               '--blender', str(blender), '--output', str(folder), '--service', service]
    command.extend(['--source', str(args.source)] if args.source else ['--dna', metadata['dna']])
    if cache:
        command.extend(['--cache', str(cache)])
    if args.allow_approximate:
        command.append('--allow-approximate')
    if args.preview:
        command.append('--preview')
    if args.geometry_only:
        command.append('--geometry-only')
    subprocess.run(command, check=True)
    count = create_zip(folder, output, metadata)
    print('ZIP_READY: %s (%d files, %.1f MiB; CRC + SHA-256 verified)' % (output, count, output.stat().st_size / 1024**2), flush=True)


if __name__ == '__main__':
    main()
