"""Serve the catalog locally and build missing DNA hulls from SharedCache on request."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import threading

from build_dna_hull import CATALOG, EXPORTER, HULL_EFFECTS_REVISION, HULL_GEOMETRY_REVISION, HULL_MATERIAL_REVISION, ensure_hull, find_blender, preferences


class HullHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        requested = Path(super().translate_path(path))
        relative = requested.relative_to(self.directory)
        if relative.parts[:1] == ('res',) and self.server.built_resources:
            return str(self.server.built_resources / relative)
        if relative.as_posix() == 'eve-model-viewer.js':
            return str(CATALOG / 'dist/eve-model-viewer.js')
        if relative.parts and relative.parts[0] in ('assets', 'data', 'vendor'):
            if relative.parts[0] == 'vendor':
                bundled = CATALOG / 'dist' / relative
                if bundled.is_file():
                    return str(bundled)
            if requested.is_file() or not self.server.published:
                return str(requested)
            return str(self.server.published / relative)
        if self.server.frontend:
            if relative == Path('.'):
                return str(self.server.frontend / 'index.html')
            public_file = (self.server.frontend / relative).resolve()
            if public_file.is_relative_to(self.server.frontend) and public_file.is_file() and not any(
                    part.startswith('.') for part in relative.parts):
                return str(public_file)
        return str(requested)

    def end_headers(self):
        if self.path.startswith('/data/dna-hulls/'):
            self.send_header('X-DNA-Hull-Geometry-Revision', str(HULL_GEOMETRY_REVISION))
            self.send_header('X-DNA-Hull-Preview', '1')
            self.send_header('X-DNA-Hull-Material-Revision', str(HULL_MATERIAL_REVISION))
            self.send_header('X-DNA-Hull-Effects-Revision', str(HULL_EFFECTS_REVISION))
        super().end_headers()

    def reply(self, status, data):
        content = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path != '/api/dna-hulls':
            return self.reply(404, {'error': 'Unknown endpoint'})
        local_hosts = {f'{host}:{self.server.server_port}' for host in ('localhost', '127.0.0.1')}
        host = self.headers.get('Host')
        if host not in local_hosts or self.headers.get('Origin') not in (None, 'http://' + host):
            return self.reply(403, {'error': 'Use the local DNA preview page'})
        if self.headers.get_content_type() != 'application/json':
            return self.reply(415, {'error': 'Expected application/json'})
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 16384:
                return self.reply(400, {'error': 'Invalid DNA request length'})
            request = json.loads(self.rfile.read(size))
            dna = request.get('dna') if isinstance(request, dict) else None
            if not isinstance(dna, str) or not dna.strip():
                return self.reply(400, {'error': 'Expected a ship DNA string'})
        except (ValueError, UnicodeError) as error:
            return self.reply(400, {'error': str(error)})

        dna = dna.strip().lower()
        item_id = request.get('itemId')
        if item_id is not None:
            if type(item_id) is not int or item_id <= 0:
                return self.reply(400, {'error': 'Invalid itemId'})
            published = self.server.items_by_id.get(item_id)
            if not published or published['modelDNA'] != dna:
                return self.reply(422, {'error': 'No published model matches this item and DNA'})
        else:
            published = self.server.items.get(dna)
        if published:
            return self.reply(200, published)
        if dna.startswith('published:'):
            return self.reply(422, {'error': 'Unknown published model key'})
        output = Path(self.directory)
        try:
            # Fold concurrent requests for a model into a single export. Blender
            # uses the GPU and a full scene, so different exports also take turns.
            with self.server.build_lock:
                path = ensure_hull(dna, self.server.cache, self.server.blender, self.server.addon, output)
                record = json.loads(path.read_bytes())
        except (ValueError, FileNotFoundError) as error:
            return self.reply(422, {'error': str(error)})
        except (OSError, subprocess.CalledProcessError) as error:
            return self.reply(500, {'error': str(error)})
        self.reply(200, record)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8795)
    parser.add_argument('--cache', type=Path, default=preferences().get('eve_shared_cache_root'))
    parser.add_argument('--blender', type=Path)
    parser.add_argument('--addon', type=Path, default=EXPORTER / '.deps/tools-blender')
    parser.add_argument('--output', type=Path, default=CATALOG.parent/'.work/dna-public')
    parser.add_argument('--published', type=Path, help='Optional published catalog and shared environment assets')
    parser.add_argument('--built-resources', type=Path, help='Builder workspace public directory, mounted at /res')
    parser.add_argument('--frontend', type=Path, help='Serve the catalog frontend on the same origin')
    args = parser.parse_args()
    if not args.cache:
        parser.error('Supply --cache or set EVE_SHARED_CACHE')
    args.output.mkdir(parents=True, exist_ok=True)
    handler = partial(HullHandler, directory=str(args.output.resolve()))
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        server.built_resources = args.built_resources.resolve() if args.built_resources else None
        server.published = args.published.resolve() if args.published else None
        server.frontend = args.frontend.resolve() if args.frontend else None
        server.items = {}
        server.items_by_id = {}
        manifest_dir = Path('assets/streamed-hulls')
        manifests = {}
        for path in (args.output / manifest_dir).glob('*.json'):
            manifest = json.loads(path.read_bytes())
            manifests[(int(path.stem), manifest['dna'].lower())] = (manifest_dir / path.name).as_posix()
        if server.published:
            index = json.loads((server.published/'data/catalog-index.json').read_bytes())
            for category in index['categories']:
                for group in category['groups']:
                    items = json.loads((server.published/group['itemsURL']).read_bytes())['items']
                    for item in items:
                        if not item.get('model') or not (server.published/item['model']).is_file():
                            continue
                        key = (item.get('dna') or f"published:{item.get('renderKey') or item['id']}").strip().lower()
                        record = dict(item, modelDNA=key, categoryID=category['id'],
                                      groupID=group['id'], preview=index.get('nativePreview'))
                        if (item['id'], key) in manifests:
                            record['renderManifest'] = manifests[item['id'], key]
                            server.items[key] = record
                        server.items.setdefault(key, record)
                        server.items_by_id[item['id']] = record
        server.cache = Path(args.cache)
        server.blender = args.blender
        server.addon = args.addon
        server.build_lock = threading.Lock()
        print(f'http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
