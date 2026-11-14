"""JSON file I/O extracted from first-generation build_catalog.py.

Standard-library API references (not proof of legacy game-data provenance):
https://docs.python.org/3/library/tempfile.html#tempfile.NamedTemporaryFile
https://docs.python.org/3/library/pathlib.html#pathlib.Path.replace
The existing retry timing is application policy, preserved during extraction.
"""
import json
from pathlib import Path
import tempfile
import time


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_json(path, value):
    """Publish complete JSON, tolerating brief Windows reader/antivirus locks."""
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                     prefix=path.name + '.', suffix='.tmp', delete=False) as stream:
        temp = Path(stream.name)
        try:
            stream.write(content)
        except BaseException:
            stream.close()
            temp.unlink(missing_ok=True)
            raise
    try:
        deadline = time.monotonic() + 5
        delay = 0.05
        while True:
            try:
                temp.replace(path)
                break
            except OSError as error:
                # Windows readers may not share DELETE access. Never truncate
                # the live file: readers must see either complete version.
                if getattr(error, 'winerror', None) not in (5, 32, 33):
                    raise
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise
                time.sleep(min(delay, remaining))
                delay = min(delay * 2, 0.5)
    finally:
        temp.unlink(missing_ok=True)
