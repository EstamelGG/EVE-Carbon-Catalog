"""Local resource-index adapter. Reads data bytes; never loads client modules."""
import csv
import hashlib
from pathlib import Path


class SourceResources:
    def __init__(self, cache, index=None, *, service="tq"):
        self.cache = Path(cache)
        self.index = {}
        self.used = {}
        self.indexes = []
        if index is not None:
            self.index = index
            return
        service_root = self.cache / service
        for folder in (service_root, service_root / 'bin64'):
            for name in ('resfileindex.txt', 'resfileindex_Windows.txt'):
                path = folder / name
                if path.is_file():
                    self.indexes.append(path)
                    with path.open(encoding='utf-8-sig', newline='') as stream:
                        self.index.update((r[0].lower(), r) for r in csv.reader(stream) if len(r) >= 3)

    @staticmethod
    def key(resource):
        key = resource.lower()
        return key[:-4] + '.black' if key.endswith('.red') else key

    def has(self, resource):
        return self.key(resource) in self.index

    def read(self, resource):
        key = self.key(resource)
        row = self.index.get(key)
        if row is None:
            raise FileNotFoundError('Missing source resource: ' + key)
        root = (self.cache / 'ResFiles').resolve()
        path = (root / row[1]).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Resource index path escapes ResFiles: ' + key)
        content = path.read_bytes()
        if hashlib.md5(content).hexdigest() != row[2].lower():
            raise ValueError('Invalid source checksum: ' + key)
        self.used[key] = dict(resource=key, sha256=hashlib.sha256(content).hexdigest(), bytes=len(content))
        return content
