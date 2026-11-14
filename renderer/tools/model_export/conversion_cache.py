"""Lossless intermediate cache keyed by source inputs, never by baked output identity."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from core import png_size
from cache_lock import file_lock


def recipe_key(recipe):
    return hashlib.sha256(json.dumps(recipe, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def material_recipe(area, sources, profile):
    # Sail crops depend on face UV domains. Keep that path uncached until the
    # crop and UV transform have their own geometry-aware cache contract.
    if 'SailsDetailMap' in area['textures']:
        return None
    return dict(kind='material', profile=profile, effect=area['effect'], kindOfArea=area['kind'],
                parameters=area['parameters'],
                sources={role: dict(resource=path.lower(), md5=sources[path.lower()]['md5'])
                         for role, path in area['textures'].items() if path})


class ConversionCache:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def lock(self, recipe):
        return file_lock(self.root / 'locks' / (recipe_key(recipe) + '.lock'))

    def restore(self, recipe, destinations):
        if recipe is None:
            return None
        folder = self.root / recipe_key(recipe)
        try:
            metadata = json.loads((folder / 'entry.json').read_text(encoding='utf-8'))
            if metadata['recipe'] != recipe or set(metadata['files']) != set(destinations):
                return None
            for role, record in metadata['files'].items():
                path = folder / (role + '.png')
                if (path.stat().st_size != record['bytes'] or list(png_size(path)) != record['size']
                        or hashlib.sha256(path.read_bytes()).hexdigest() != record['integrity']):
                    return None
            for role, target in destinations.items():
                shutil.copyfile(folder / (role + '.png'), target)
            return metadata['details']
        except (OSError, ValueError, KeyError):
            return None

    def store(self, recipe, files, details):
        if recipe is None:
            return
        folder = self.root / recipe_key(recipe)
        # Publish metadata last inside an isolated directory; incomplete work
        # can never masquerade as a valid hit after interruption.
        with tempfile.TemporaryDirectory(dir=self.root) as temp:
            stage = Path(temp)
            records = {}
            for role, source in files.items():
                target = stage / (role + '.png')
                shutil.copyfile(source, target)
                # Output digest only detects damaged cache files; it is never
                # the resource identity or a criterion for visual equivalence.
                records[role] = dict(bytes=target.stat().st_size, size=list(png_size(target)),
                                     integrity=hashlib.sha256(target.read_bytes()).hexdigest())
            (stage / 'entry.json').write_text(json.dumps(dict(recipe=recipe, files=records, details=details)), encoding='utf-8')
            folder.mkdir(exist_ok=True)
            for path in stage.iterdir():
                if path.name != 'entry.json':
                    path.replace(folder / path.name)
            (stage / 'entry.json').replace(folder / 'entry.json')
