"""Python 2/3 JSON reads with bounded retries for Windows file sharing races."""
import errno
import json
import time


def read_json(path, attempts=40, delay=.05):
    for attempt in range(attempts):
        try:
            with open(path, 'rb') as stream:
                content = stream.read()
            return json.loads(content.decode('utf-8-sig'))
        except (IOError, OSError) as error:
            if error.errno not in (errno.EACCES, errno.EPERM, errno.ENOENT) or attempt == attempts - 1:
                raise
            time.sleep(delay)
