"""Retain the buffer views referenced by glTF geometry, skins and animation accessors."""


def geometry_buffer(doc, binary):
    used = set()
    for accessor in doc['accessors']:
        if 'bufferView' in accessor: used.add(accessor['bufferView'])
        for value in accessor.get('sparse', {}).values():
            if isinstance(value, dict) and 'bufferView' in value: used.add(value['bufferView'])
    packed, views, remap = bytearray(), [], {}
    for old in sorted(used):
        view = dict(doc['bufferViews'][old]); offset = view.get('byteOffset', 0)
        packed.extend(b'\0' * (-len(packed) % 4)); new_offset = len(packed)
        packed.extend(binary[offset:offset+view['byteLength']]); view.update(buffer=0, byteOffset=new_offset)
        remap[old] = len(views); views.append(view)
    for accessor in doc['accessors']:
        if 'bufferView' in accessor: accessor['bufferView'] = remap[accessor['bufferView']]
        for value in accessor.get('sparse', {}).values():
            if isinstance(value, dict) and 'bufferView' in value: value['bufferView'] = remap[value['bufferView']]
    doc['bufferViews'] = views
    return bytes(packed)
