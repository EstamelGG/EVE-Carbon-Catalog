"""Stream subprocess logs while retaining them on disk; bound quiet stages."""
import os
import subprocess
import sys
import time
import threading
import re

CANCEL_EVENT = threading.Event()


class BuildCancelled(Exception):
    pass


def failure_summary(error):
    """Prefer the worker's root diagnostic over the outer subprocess command."""
    output = getattr(error, 'output', '') or ''
    if isinstance(output, bytes): output = output.decode('utf-8', errors='replace')
    errors = re.findall(r'^(?:ValueError|RuntimeError|FileNotFoundError|KeyError|TypeError|AssertionError): .+$', output, re.M)
    if errors: return errors[-1]
    if 'EXCEPTION_ACCESS_VIOLATION' in output:
        return 'Blender 原生访问冲突（EXCEPTION_ACCESS_VIOLATION），请查看该物品导出日志'
    return str(error)


def run_logged(command, log_path, env=None, timeout=1800, cwd=None, label='处理', heartbeat=15):
    if CANCEL_EVENT.is_set(): raise BuildCancelled('Build interrupted')
    started = last_output = time.monotonic()
    env = dict(os.environ if env is None else env)
    env['PYTHONUNBUFFERED'] = '1'
    with open(log_path, 'wb') as output, open(log_path, 'r', encoding='utf-8', errors='replace') as reader:
        process = subprocess.Popen(command, env=env, cwd=cwd, stdout=output, stderr=subprocess.STDOUT,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            while True:
                if CANCEL_EVENT.is_set(): raise BuildCancelled('Build interrupted')
                chunk = reader.read()
                now = time.monotonic()
                if chunk:
                    sys.stdout.write(chunk)
                    sys.stdout.flush()
                    last_output = now
                if process.poll() is not None:
                    sys.stdout.write(reader.read())
                    sys.stdout.flush()
                    if process.returncode:
                        reader.seek(max(0, reader.seek(0, 2) - 24000))
                        raise subprocess.CalledProcessError(process.returncode, command, output=reader.read())
                    return
                if now - started > timeout:
                    raise subprocess.TimeoutExpired(command, timeout)
                if now - last_output >= heartbeat:
                    print(f'  {label}仍在运行 · 已用时 {now - started:.0f}s', flush=True)
                    last_output = now
                time.sleep(0.25)
        finally:
            if process.poll() is None:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    process.kill()
                process.wait()
