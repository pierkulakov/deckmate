"""2026-11-07: rebuild the project's generated board files with its own renderer.

Loads <project>/Tools/board.py and calls its build() to re-render only the board and
table files it declares (board.BOARD, board.TABLE). Each file is written back
atomically (temporary file + os.replace) and only if its content actually changed;
if the file was modified while rendering, the rebuild of that file is aborted.
The project's main() is never run: it would also apply reverse Obsidian moves and
normalize every mechanics file, which this tool must not touch.
"""
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
    bom = original.startswith('﻿')
    if original.removeprefix('﻿').replace('\r\n', '\n') != text:
        # Keep the file's own BOM and line endings: only the changed content may differ.
        if '\r\n' in original:
            text = text.replace('\n', '\r\n')
        if bom:
            text = '﻿' + text
        temporary = target.with_name(target.name + '.deckmate-' + uuid.uuid4().hex + '.tmp')
        try:
            temporary.write_bytes(text.encode('utf-8'))
            if target.read_bytes() != originals[relative]:
                raise RuntimeError('Generated file changed during rebuild: ' + relative)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        print('rebuilt:', relative)
