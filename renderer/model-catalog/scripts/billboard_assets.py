"""Content-addressed English billboard media for the offline preview."""
import struct

from pipeline_common import publish
from source_resources import SourceResources


# Public channel bindings: carbonengine/trinity f644516, EveSOF.cpp L1227-L1233.
# The folder names and poster are original resource labels in billboards.fsdbinary.
# The preview selects default English folders and sorts filenames. No public
# per-table schema or game playlist scheduler was located.
COMMON = 'res:/video/billboards/common/'
CHANNELS = {
    'dynamic:/hangarvideos': (COMMON,),
    'dynamic:/inspacevideos': (COMMON, 'res:/video/billboards/space/'),
}
POSTER = 'res:/video/billboards/fallback.png'


class BillboardAssets:
    def __init__(self, index, cache, output):
        self.source = SourceResources(cache, index)
        self.output = output
        self.urls = {}
        self.channels = {}
        self.size = None

    def texture(self, channel):
        if channel not in self.channels:
            folders = CHANNELS[channel]
            paths = sorted(p for p in self.source.index if p.startswith(folders) and p.endswith('.webm'))
            if not paths:
                raise ValueError('No cached videos for ' + channel)
            if self.size is None:
                # W3C PNG 11.2.2: IHDR starts with the big-endian dimensions.
                poster = self.source.read(POSTER)
                if not poster.startswith(b'\x89PNG\r\n\x1a\n') or poster[12:16] != b'IHDR':
                    raise ValueError('Invalid billboard poster: ' + POSTER)
                self.size = struct.unpack_from('>II', poster, 16)
            for path in paths:
                if path not in self.urls:
                    self.urls[path] = publish(self.output, 'video', self.source.read(path), 'webm')['url']
            self.channels[channel] = tuple(self.urls[p] for p in paths)
        playlist = list(self.channels[channel])
        return dict(url=playlist[0], channel=channel, video=True, playlist=playlist, size=list(self.size))
