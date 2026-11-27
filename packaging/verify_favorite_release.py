"""Check that the delivered executable embeds this checkout's favorite UI fixes."""
import hashlib
from pathlib import Path
from PyInstaller.archive.readers import CArchiveReader

root = Path(__file__).resolve().parent.parent
archive = CArchiveReader(str(root / 'dist' / 'NERV Panel.exe'))
names = {name.replace('\\', '/'): name for name in archive.toc}
for rel in ('public/css/audio.css', 'public/css/style.css', 'public/js/favorite-sort.js', 'public/js/app.js', 'public/js/audio-ui.js', 'public/js/process-association.js', 'public/index.html', 'server/apps.js', 'server/game-procs.js', 'server/process-associations.js', 'server/procs.js', 'server/audio.js', 'server/index.js', 'server/ps/audio-core.cs', 'server/ps/audio-session.ps1', 'runtime-manifest.json'):
    key = 'bundle/' + rel
    embedded = archive.extract(names[key])
    staged = (root / 'build' / 'bundle' / rel).read_bytes()
    assert embedded == staged, 'EXE differs from staging: ' + rel
    if rel != 'runtime-manifest.json':
        assert staged == (root / rel).read_bytes(), 'Staging differs from source: ' + rel
    print('MATCH', rel, hashlib.sha256(embedded).hexdigest())
assert b'function autoScroll(time)' in (root / 'public/js/favorite-sort.js').read_bytes()
assert b'appearance:none' in (root / 'public/css/audio.css').read_bytes()
print('PASS: executable embeds compact transparent controls and drag edge scrolling')
