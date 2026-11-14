# SOURCE AUDIT 2026-11-11 [B04]: Pinned upstream is public but declares reverse-engineering origins and inconsistent Oodle attribution; not blanket clearance.
# See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
# Reference: https://github.com/carbonenginejs/tools-blender/blob/a4e0e709ac3dc80bd83846ed26f687757a154c48/NOTICE
"""Install a pinned, local-only importer; no Blender add-on registration required."""
import argparse
from contextlib import nullcontext
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
from core import DEPENDENCY_REVISION, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Existing tools-blender Git checkout (offline install)")
    args = parser.parse_args()
    destination = Path(__file__).resolve().parent / ".deps" / "tools-blender"
    existing_checkout = (destination / '.git').exists()
    if destination.exists() and not existing_checkout:
        raise SystemExit("Dependency directory already exists: " + str(destination))
    if existing_checkout and args.source and args.source.resolve() != destination:
        raise SystemExit("Choose the existing importer checkout as --source: " + str(destination))
    def reject_checkout(reason):
        if existing_checkout:
            (destination / "ccpdec-dependency.json").unlink(missing_ok=True)
        raise SystemExit(reason)

    if existing_checkout:
        args.source = destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_context = nullcontext(None) if args.source else tempfile.TemporaryDirectory(prefix="install-", dir=destination.parent)
    with temporary_context as temporary:
        source = args.source
        if source is None:
            source = Path(temporary) / "repo"
            subprocess.run(["git", "clone", "https://github.com/carbonenginejs/tools-blender.git", str(source)], check=True)
            subprocess.run(["git", "-C", str(source), "checkout", "--detach", DEPENDENCY_REVISION], check=True)
        revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
        if revision != DEPENDENCY_REVISION:
            reject_checkout("Expected importer revision " + DEPENDENCY_REVISION + ", got " + revision)
        if subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True).strip():
            reject_checkout("Importer has tracked modifications; use a clean checkout")
        receipt = dict(revision=revision, repository="https://github.com/carbonenginejs/tools-blender")
        if existing_checkout:
            extras = subprocess.check_output(["git", "-C", str(source), "ls-files", "--others",
                                               "-z", "--", "addons", "packages"]).split(b"\x00")
            for entry in filter(None, extras):
                path = Path(os.fsdecode(entry))
                suffix = path.suffix.lower()
                if suffix == '.pyc' and path.parent.name == '__pycache__':
                    continue
                if suffix in ('.py', '.pyc', '.pyw', '.pyd', '.so'):
                    reject_checkout("Existing importer has an untracked importable module: " + str(path))
            write_json(destination / "ccpdec-dependency.json", receipt)
        else:
            # Publish only the tracked files of the pinned commit. A local
            # upstream worktree can contain unrelated scripts and generated files.
            with tempfile.TemporaryDirectory(prefix="export-", dir=destination.parent) as staging:
                snapshot = Path(staging) / 'tools-blender'
                snapshot.mkdir()
                archive = Path(staging) / 'source.tar'
                subprocess.run(["git", "--no-replace-objects", "-C", str(source), "archive", "--format=tar",
                                "--output=" + str(archive), DEPENDENCY_REVISION], check=True)
                with tarfile.open(archive) as files:
                    files.extractall(snapshot, filter='data')
                write_json(snapshot / "ccpdec-dependency.json", receipt)
                snapshot.rename(destination)
    print("Installed:", destination)


if __name__ == "__main__":
    main()
