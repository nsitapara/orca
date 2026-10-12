"""09 · Prepare reviews requested of me (review-requests): the decisions of sweep.plan() and plan_pass(), without writing.

Words: ask (a Prepare card would be offered; the reason is its context line), already (a card for this head is in the
job's notes), skip (plan()'s reason: my own MR, or an approval). A review request is listed only when I am a reviewer, so
one that isn't mine to review has no word at all. Keys `mr:<iid>` (contract §3).

The job's notes come from the case (state `review-requests/vault.json`: {"notes": {"<job folder>/<note>.md": text}}) and
are read from a temporary vault; a recording reads the real folder and keeps what it found.
"""

import os
import tempfile
from pathlib import Path
from unittest import mock

from jobs.common import repo_extras

SWEEP = "review-requests"
STATE = ("review-requests", "vault.json")


def _real_notes():
    import vault

    folder = vault.job_dir(SWEEP)
    if not folder.is_dir():
        return {}
    return {f"{folder.name}/{note.name}": note.read_text() for note in sorted(folder.glob("*.md"))}


def _notes(gate):
    saved = gate.load(*STATE)
    return saved["notes"] if "notes" in saved else _real_notes()


def _items(sweep, gate):
    """Every item in the job's notes, read the way sweep.run_pass does, from a temp vault so nothing real is touched."""
    import vault

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for rel, text in _notes(gate).items():
            note = root / "Agent Work" / "Automations" / rel
            note.parent.mkdir(parents=True, exist_ok=True)
            note.write_text(text)
        # ParityIO answers Path.exists from the case; these files are real, so read_items asks the disk.
        with mock.patch.multiple(vault, VAULT=root, AUTOMATIONS=root / "Agent Work" / "Automations", LOCK_DIR=root / "locks"), \
                mock.patch.object(Path, "exists", lambda self, *a, **k: os.path.exists(self)):
            return [item for note in sweep.card_notes() for item in vault.read_items(note)]


def _word(rest, mr, sweep):
    if rest.startswith("skip: "):
        return "skip", rest[len("skip: "):]
    if rest.startswith("ask: already offered"):
        return "already", rest
    return "ask", sweep.prepare_card(mr)["context"]


def old_decisions(sweep, gate):
    import vault

    mrs, me, approvers = sweep.requests()
    verdicts = list(sweep.plan(mrs, me, approvers))
    _, _, log = sweep.plan_pass(verdicts, _items(sweep, gate), vault.item_key)
    by_iid = {mr["iid"]: mr for mr, _, _ in verdicts}
    out = []
    for line in log:
        iid, rest = line.split(" ", 1)
        mr = by_iid[int(iid[1:])]
        decision, reason = _word(rest, mr, sweep)
        out.append({"key": f"mr:{mr['iid']}", "label": f"!{mr['iid']} {mr['source_branch']}", "decision": decision, "reason": reason})
    return out


def record_extras(gate, io):
    """Keep the notes the plan read, so the case replays without the vault."""
    io.state["/".join(STATE)] = {"notes": _real_notes()}


fixture_extras = repo_extras
