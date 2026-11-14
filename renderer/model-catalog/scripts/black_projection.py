"""Read selected root-object fields from Blue's published BLACK v1 format.

Based on carbonengine/blue at d9d67648e0ffaae397e6399b3e072e05c2380080:
src/BlackReader.cpp (header, string tables, object lengths and references) and
src/IRootReader.cpp (property wire types). Copyright © 2012 CCP ehf.
MIT terms: ../../docs/licenses/carbon-blue-MIT.txt.
https://github.com/carbonengine/blue/blob/d9d67648e0ffaae397e6399b3e072e05c2380080/src/BlackReader.cpp

This is a projection reader, not a runtime object factory. Unselected nested
objects remain opaque records; no constructors, effects or curves execute.
The caller supplies property types from published class declarations. Selected
nested classes can also be projected; other subtrees remain opaque. Unknown
properties in projected classes fail instead of guessing their representation.
"""
import struct


class BlackProjection:
    def __init__(self, content, schemas=None):
        self.content = content
        self.offset = 0
        self.references = {}
        self.objects = {}
        self.types = {}
        self.schemas = dict(schemas or {})
        if self.value('II') != (0xB1ACF11E, 1):
            raise ValueError('Expected Blue BLACK version 1')
        self.strings = self.string_table('utf-8')
        self.wstrings = self.string_table('utf-16-le')

    def take(self, size):
        end = self.offset + size
        if size < 0 or end > len(self.content):
            raise ValueError('BLACK record exceeds input')
        data = self.content[self.offset:end]
        self.offset = end
        return data

    def value(self, fmt):
        values = struct.unpack('<' + fmt, self.take(struct.calcsize('<' + fmt)))
        return values[0] if len(values) == 1 else values

    def string_table(self, encoding):
        size = self.value('I')
        block = self.take(size)
        if size < 2:
            raise ValueError('Invalid BLACK string table')
        count = struct.unpack_from('<H', block)[0]
        entries = block[2:].decode(encoding).split('\0')
        if len(entries) != count + 1 or entries[-1] != '':
            raise ValueError('Invalid BLACK string table length')
        return entries[:-1]

    def string(self, wide=False):
        table = self.wstrings if wide else self.strings
        index = self.value('H')
        if index >= len(table):
            raise ValueError('Invalid BLACK string index')
        return table[index]

    def object_bounds(self):
        reference = self.value('I')
        if reference == 0:
            return None
        if reference in self.references:
            return self.references[reference]
        size = self.value('I')
        start = self.offset
        self.take(size)
        bounds = (start, self.offset)
        self.references[reference] = bounds
        return bounds

    def record(self, expected_type=None, inline=False):
        if inline:
            # BlackReader::ReadIRoot for an embedded value: length, no reference ID.
            size = self.value('I')
            start = self.offset
            self.take(size)
            bounds = (start, self.offset)
        else:
            bounds = self.object_bounds()
        return self.record_at(bounds, expected_type)

    def record_at(self, bounds, expected_type=None, required_fields=None):
        if bounds is None:
            return None
        start, end = bounds
        resume = self.offset
        if start in self.objects:
            return self.objects[start]
        self.offset = start
        actual_type = self.string()
        if expected_type is not None and actual_type != expected_type:
            raise ValueError('Expected %s, found %s' % (expected_type, actual_type))
        schema = self.schemas.get(actual_type)
        if schema is None:
            raise ValueError('Unsupported published class: ' + actual_type)
        result = {}
        self.objects[start] = result
        self.types[id(result)] = actual_type
        while self.offset < end:
            name = self.string()
            if name not in schema:
                raise ValueError('Unsupported published field: %s.%s' % (actual_type, name))
            result[name] = self.field(schema[name])
            if required_fields is not None and required_fields <= result.keys() and self.offset <= end:
                # A projection may stop once every requested field was read. The
                # object length supplied by Blue bounds the unselected remainder.
                self.offset = end
        if self.offset != end:
            raise ValueError('BLACK object length mismatch')
        self.offset = resume
        return result

    def field(self, kind):
        if isinstance(kind, tuple) and kind[0] == 'structures':
            # Caller specifies the layout from a published C++ structure.
            count, stride = self.value('IH')
            if stride != struct.calcsize('<' + kind[1]):
                raise ValueError('BLACK structure stride differs from published layout')
            return [list(self.value(kind[1])) for _ in range(count)]
        if kind == 'binary':
            # BlackReader::ReadBinaryBlock prefixes an ICustomPersist payload with its byte count.
            return self.take(self.value('i'))
        if kind == 'string':
            return self.string()
        if kind == 'wstring':
            return self.string(wide=True)
        if kind == 'object':
            self.object_bounds()
            return None
        if kind in ('objects', 'count'):
            count = self.value('I')
            for _ in range(count):
                self.object_bounds()
            return count if kind == 'count' else None
        if kind == 'record':
            return self.record()
        if kind == 'inline':
            return self.record(inline=True)
        if kind == 'records':
            return [self.record() for _ in range(self.value('I'))]
        if kind == 'structures':
            # BlackReader::ReadStructureList, count + uint16 stride + raw bytes.
            # Opaque projection: no platform-dependent structures are decoded.
            count, stride = self.value('IH')
            self.take(count * stride)
            return None
        value = self.value(kind)
        return list(value) if isinstance(value, tuple) else value

    def root_type(self):
        # Blue BlackReader::ReadIRootClass (lines 307-341). The root is the
        # first object, so its non-null reference always includes the record.
        position = self.offset
        try:
            reference, size = self.value('II')
            if not reference or size < 2 or size != len(self.content) - self.offset:
                raise ValueError('Invalid BLACK root record')
            return self.string()
        finally:
            self.offset = position

    def root(self, expected_type, schema):
        self.schemas[expected_type] = schema
        result = self.record(expected_type)
        if result is None:
            raise ValueError('Missing BLACK root')
        if self.offset != len(self.content):
            raise ValueError('BLACK root length mismatch')
        return result
