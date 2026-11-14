"""Build low-resolution environment maps, filtering packed material channels independently."""
import hashlib
import io
import json
from pathlib import Path
import sys

from PIL import Image

MAX_EDGE = 1024

def convert(source, dest):
    with Image.open(source) as image:
        if max(image.size) <= MAX_EDGE:
            return None
        size = tuple(max(1, round(side * MAX_EDGE / max(image.size))) for side in image.size)
        channels = [channel.resize(size, Image.Resampling.BOX) for channel in image.convert("RGBA").split()]
        encoded = io.BytesIO()
        Image.merge("RGBA", channels).save(encoded, format="WEBP", lossless=True, exact=True, method=2)
        data = encoded.getvalue()
        filename = hashlib.sha256(data).hexdigest() + ".webp"
        (dest / filename).write_bytes(data)
        return filename

if __name__ == "__main__":
    print(json.dumps([convert(source, Path(sys.argv[1])) for source in json.load(sys.stdin)]))
