"""Read-only oracle: execute the project's real parser on the captured input (2026-11-03)."""
import importlib.util
import base64
import json
import pathlib
import sys

sys.dont_write_bytecode = True
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
payload = json.load(sys.stdin)
module_path = pathlib.Path(payload["root"]) / "Tools" / "board.py"
specification = importlib.util.spec_from_file_location("deckmate_board_oracle", module_path)
board = importlib.util.module_from_spec(specification)
specification.loader.exec_module(board)
# A snapshot avoids comparing two versions when an agent edits the live repository.
sources = {relative: base64.b64decode(encoded) for relative, encoded in payload["documents"].items()}
board.read = lambda relative: sources[relative].decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")

def byte_ranges(raw):
    """Independent line scanner validates that each patch belongs to its own heading."""
    offset = 3 if raw.startswith(b'\xef\xbb\xbf') else 0
    ranges, active, fence = [], None, False
    for line in raw[offset:].decode('utf-8').splitlines(keepends=True):
        body = line.rstrip('\r\n')
        if body.lstrip().startswith('```'):
            fence = not fence
        if not fence:
            if board.re.match(r'^#{1,3}\s', body) and active is not None:
                active['end'] = offset
                active = None
            if board.SLICE.match(body):
                active = {'start': offset, 'end': len(raw)}
                ranges.append(active)
        offset += len(line.encode('utf-8'))
    return ranges
documents = {}
for relative in payload["documents"]:
    name, slices = board.slices(relative)
    documents[relative] = {"name": name, "slices": slices, "ranges": byte_ranges(sources[relative])}
print(json.dumps({"documents": documents, "mechanicFiles": board.mechanic_files(),
                  "iteration": board.iteration()}, ensure_ascii=False))
