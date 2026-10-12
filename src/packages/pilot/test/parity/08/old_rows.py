#!/usr/bin/env python3
"""Old side of 08's parity: usage.py's own rows for the sessions a case names.

  old_rows.py <case dir>   prints usage.rows() as JSON (no ledger, no Orca, no cache: just the parse and the rows)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".agents" / "skills" / "worktree-gate"))
import usage  # noqa: E402


def rows(case_dir):
    case = json.loads((case_dir / "case.json").read_text())
    sessions = []
    for s in case["sessions"]:
        buckets = {}
        for rel, thread in s["files"]:
            path = case_dir / rel
            parsed = usage.parse_claude(path) if s["agent"] == "claude" else usage.parse_codex(path, thread)
            for key, row in parsed.items():
                usage._merge(buckets, key, row)
        sessions.append({"job": s["job"], "source": "run", "agent": s["agent"], "cwd": s["cwd"], "title": s["title"],
                         "at": s["at"], "session": s["session"], "buckets": buckets})
    return usage.rows(sessions)


if __name__ == "__main__":
    print(json.dumps({"rows": rows(Path(sys.argv[1])), "csv_fields": list(usage.CSV_FIELDS)}))
