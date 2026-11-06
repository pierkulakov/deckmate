"""2026-11-03: use the project's board renderer without importing Obsidian moves into mechanics."""
import importlib.util
from pathlib import Path
import sys
import os
import uuid

root = Path(sys.argv[1]).resolve()
script = (root / 'Tools' / 'board.py').resolve(strict=True)
if not script.is_relative_to(root):
    raise ValueError('board.py is outside the project')
spec = importlib.util.spec_from_file_location('deckmate_board', script)
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)

# The project's grammar and generation remain authoritative. Its main() also
# applies reverse moves and normalizes every mechanic, which would violate block writes.
originals = {relative: (root / relative).read_bytes() for relative in (board.BOARD, board.TABLE)}
for relative, text in board.build().items():
    target = (root / relative).resolve(strict=True)
    if relative not in (board.BOARD, board.TABLE) or target.parent != root / 'tasks':
        raise ValueError('Unexpected generated board path')
    with target.open('r', encoding='utf-8', newline='') as source:
        original = source.read()
    if original.replace('\r\n', '\n') != text:
        temporary = target.with_name(target.name + '.deckmate-' + uuid.uuid4().hex + '.tmp')
        try:
            temporary.write_bytes(text.encode('utf-8'))
            if target.read_bytes() != originals[relative]:
                raise RuntimeError('Generated file changed during rebuild: ' + relative)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        print('rebuilt:', relative)
