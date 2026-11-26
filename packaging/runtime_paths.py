"""Content-addressed runtime payloads; no firewall or elevation operations."""
import hashlib
import json
import uuid
from pathlib import Path
import shutil
import tempfile

MANIFEST = "runtime-manifest.json"


def file_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def manifest_version(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def write_manifest(root):
    files = {p.relative_to(root).as_posix(): file_digest(p)
             for p in sorted(root.rglob("*")) if p.is_file() and p.name != MANIFEST}
    (root / MANIFEST).write_text(json.dumps({"version": manifest_version(files), "files": files},
                                          ensure_ascii=False, indent=2), encoding="utf-8")


def read_manifest(root):
    manifest = json.loads((root / MANIFEST).read_text(encoding="utf-8"))
    files = manifest["files"]
    if not files or manifest["version"] != manifest_version(files):
        raise RuntimeError("Invalid runtime manifest: " + str(root))
    for relative in files:
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or ":" in relative or "\\" in relative:
            raise RuntimeError("Unsafe runtime manifest path: " + relative)
    for required in ("node.exe", "server/index.js", "package.json", "public/index.html"):
        if required not in files:
            raise RuntimeError("Runtime manifest missing " + required)
    return manifest


def validate_runtime(root, manifest):
    try:
        if read_manifest(root) != manifest:
            return False
        actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
        if actual != set(manifest["files"]) | {MANIFEST}:
            return False
        return all(not (root / rel).is_symlink() and file_digest(root / rel) == digest
                   for rel, digest in manifest["files"].items())
    except (OSError, ValueError, KeyError, RuntimeError):
        return False


def resolve_runtime(executable, embedded, user_data):
    """Installed payload wins. Portable copies whole verified releases atomically.

    Caller must own the application single-instance mutex before invoking this.
    User configuration never enters these runtime-only directories.
    """
    installed = executable.parent / "runtime"
    if installed.exists():
        manifest = read_manifest(installed)
        if not validate_runtime(installed, manifest):
            raise RuntimeError("Installed runtime is incomplete; reinstall: " + str(installed))
        return installed
    manifest = read_manifest(embedded)
    cache = user_data / "runtime"
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / manifest["version"]
    if validate_runtime(target, manifest):
        return target
    staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=cache))
    backup = None
    try:
        shutil.copytree(embedded, staging, dirs_exist_ok=True)
        if not validate_runtime(staging, manifest):
            raise RuntimeError("Embedded runtime failed integrity verification")
        if target.exists():
            backup = cache / (".invalid-" + uuid.uuid4().hex)
            target.rename(backup)
        try:
            staging.rename(target)
        except OSError:
            if backup is not None:
                backup.rename(target)
            raise
        if backup is not None:
            shutil.rmtree(backup)
        return target
    finally:
        if staging.exists():
            shutil.rmtree(staging)
