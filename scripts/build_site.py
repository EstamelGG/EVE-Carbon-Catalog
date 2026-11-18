import json
import hashlib
import os
import re
import shutil
from datetime import datetime, timezone
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def render_branding(destination):
    config = json.loads((ROOT / 'app-config.json').read_bytes())
    name, version = config['appName'], config['appVersion']
    labels = {'appName': name, 'appVersion': version, 'appNameUpper': name.upper()}
    public = ROOT / 'public'
    for filename in ('index.html', 'viewer-guide.html'):
        template = (public / filename).read_text(encoding='utf-8')
        html = re.sub(r'\{\{(appName|appVersion|appNameUpper)\}\}',
                      lambda match: escape(labels[match[1]]), template)
        (destination / filename).write_text(html, encoding='utf-8')
    template = (public / 'messages.mjs').read_text(encoding='utf-8')
    messages = template.replace('"{{appTitle}}"', json.dumps(f'{name} {version}'))
    (destination / 'messages.mjs').write_text(messages, encoding='utf-8')


def main():
    public = ROOT / 'public'
    renderer = ROOT / 'renderer/model-catalog/dist'
    dist = ROOT / 'dist'
    if dist.resolve() != dist:
        raise ValueError('dist must be inside the checkout')
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(public, dist)
    render_branding(dist)
    shutil.copy2(renderer / 'eve-model-viewer.js', dist)
    shutil.copytree(renderer / 'vendor', dist / 'vendor')
    shutil.copy2(renderer / 'third-party-notices.txt', dist / 'renderer-notices.txt')
    config = json.loads((dist / 'site-config.json').read_bytes())
    config['frontendPublishedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    renderer_hash = hashlib.sha256((dist / 'eve-model-viewer.js').read_bytes()).hexdigest()[:16]
    config['rendererModuleURL'] = f'./eve-model-viewer.js?v={renderer_hash}'
    for env, field in [('RESOURCE_BASE_URL', 'resourceBaseURL'), ('RENDERER_MODULE_URL', 'rendererModuleURL')]:
        if os.environ.get(env):
            config[field] = os.environ[env]
    write_json(dist / 'site-config.json', config)


if __name__ == '__main__':
    main()
