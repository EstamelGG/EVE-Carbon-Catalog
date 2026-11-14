# SOURCE AUDIT 2026-11-11 [B04]: Pinned upstream is public but declares reverse-engineering origins and inconsistent Oodle attribution; not blanket clearance.
# See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
# Reference: https://github.com/carbonenginejs/tools-blender/blob/a4e0e709ac3dc80bd83846ed26f687757a154c48/NOTICE
"""Filesystem and source-resolution contracts (standard library only)."""
import csv
import hashlib
import json
from pathlib import Path
import re
import struct

VERSION = "1.0.0"
DEPENDENCY_REVISION = "a4e0e709ac3dc80bd83846ed26f687757a154c48"


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def inside(root, relative):
    root = Path(root).resolve()
    path = (root / str(relative).replace("\\", "/")).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Path escapes source directory: " + str(relative))
    return path


def resource_name(resource):
    # Hash the logical path too: different folders often have identical basenames.
    stem = re.sub(r"[^A-Za-z0-9_.-]", "_", resource.rsplit("/", 1)[-1])
    return hashlib.sha256(resource.lower().encode()).hexdigest()[:12] + "_" + stem


def dds_info(path):
    with Path(path).open("rb") as stream:
        header = stream.read(148)
    return dds_header_info(header)


def dds_header_info(header):
    """DDS_HEADER and optional DXT10 resource kind, as documented by Microsoft.
    https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header-dxt10
    """
    if len(header) < 128 or header[:4] != b'DDS ':
        raise ValueError('Invalid DDS header')
    height, width = struct.unpack_from('<II', header, 12)
    depth = struct.unpack_from('<I', header, 24)[0]
    caps = struct.unpack_from('<I', header, 112)[0]
    info = dict(width=width, height=height, depth=depth,
                volume=depth > 1 or bool(caps & 0x200000), cubemap=bool(caps & 0x200))
    if header[84:88] == b'DX10':
        if len(header) < 148:
            raise ValueError('Truncated DDS DX10 header')
        dimension, flags, layers = struct.unpack_from('<3I', header, 132)
        if dimension not in (2, 3, 4) or layers < 1:
            raise ValueError('Invalid DDS DX10 resource dimensions')
        info['volume'] = dimension == 4
        info['cubemap'] = bool(flags & 4) or info['cubemap']
        if layers != 1:
            info['arraySize'] = layers
    return info


def png_size(path):
    with Path(path).open("rb") as stream:
        header = stream.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Not a PNG: " + str(path))
    return struct.unpack_from(">II", header, 16)


def collect_sources(data, output, source=None, cache=None, service="tq", *, resource_index=None):
    """Copy verified source bytes. Never modify SharedCache or legacy exports."""
    output = Path(output)
    previous = {}
    if source and (Path(source) / "source-manifest.json").exists():
        previous = {f["resource"].lower(): f for f in read_json(Path(source) / "source-manifest.json")["files"]}
    if not data.get("geometry"):
        geometries = [key for key in previous if key.endswith(".gr2")]
        if len(geometries) != 1:
            raise ValueError("Material capture needs a geometry resource path")
        data["geometry"] = geometries[0]
    resources = {data["geometry"]}
    resources.update(v for area in data["areas"] for v in area["textures"].values() if v)
    index = {} if resource_index is None else resource_index
    if cache and resource_index is None:
        for folder in (Path(cache) / service, Path(cache) / service / "bin64"):
            for filename in ("resfileindex.txt", "resfileindex_Windows.txt"):
                path = folder / filename
                if path.exists():
                    with path.open(encoding="utf-8-sig") as stream:
                        index.update({r[0].lower(): r for r in csv.reader(stream) if len(r) >= 3})
    files = []
    for resource in sorted(resources):
        key = resource.lower()
        if key in previous:
            record = previous[key]
            path = inside(source, record["extracted"])
            expected = record["md5"]
            cache_relative = record.get("cacheRelative")
        elif key in index:
            row = index[key]
            path = inside(Path(cache) / "ResFiles", row[1])
            expected, cache_relative = row[2], row[1]
        else:
            raise FileNotFoundError("Resource not captured: " + resource + "; supply --cache")
        content = path.read_bytes()
        digest = hashlib.md5(content).hexdigest()
        if digest.lower() != expected.lower():
            raise ValueError("Source MD5 mismatch: " + resource)
        relative = "raw/" + resource_name(resource)
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        record = dict(resource=resource, extracted=relative, md5=digest,
                      bytes=len(content), cacheRelative=cache_relative)
        if content[:4] == b"DDS ":
            record["dds"] = dds_info(destination)
        files.append(record)
    write_json(output / "default-materials.json", data)
    write_json(output / "source-manifest.json", dict(version=VERSION, dna=data.get("dna"),
               typeID=data.get("typeID"), files=files))
    return files
