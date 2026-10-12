"""04 · Test branch UIs overnight (ui-qa/scripts/loop.py).

Tick decisions: ui-qa's own plan() (due.decide, then its holds: automatic fixes running, answers waiting or an agent
working, the 12-hour hold on a failed head; due rows longest-waiting first) over the case, then loop.py sweep's start
rules for the due rows: a QA run in progress holds the night (its worktree held_active, every due row held); outside
02:00-05:59 a due row is outside; else the first due row starts unless Codex is out of quota (QUOTA), and the rest are
queued for the next tick. Every read (Orca's worktrees and terminals, GitLab, git, the git-operation markers, the saved
state) comes from the case through ParityIO. The one stub is gate.answers_pending, which reads the branch note's file:
the case's parity/answers.json ({branch: answers waiting}) answers it. Quota is the case's raw Codex answer
(quota/codex-rate-limits.json). Words per worktree gate.worktrees(include_finished=True) lists (wt:<id>): baseline, idle,
skip, start, queued, outside, QUOTA, held_active, held. A teammate's worktree, or one whose owner GitLab can't name, is
never listed and gets no decision. A case with a dead run (the sweep would close it out first) isn't a decision case.

Night outcomes (Task 46d): a case whose parity/case.json carries `nights` ([{name, stack, test, finished, nothing,
renderFailed}]) returns one decision per night (night:<n>) whose `decision` is close_out's outcome for a Pilot run that
ended that way (pilot_mode.classify; render_failed when the report didn't render) and whose `reason` is `tested` (seen
moves) or `retried` (failed.json, retried after 12 hours), by loop.counts_as_tested.

ui-qa has no sweep.py, so SWEEP is None and this adapter imports ui-qa's scripts itself. The cases are synthetic
(synthetic.py); a live recording (Task 47b) needs a record_extras for the reads Pilot makes beyond the sweep's.
"""

import os
import sys
import time
from pathlib import Path
from unittest import mock

from jobs.common import codex_over, repo_extras
from parity_io import NotInFixture

SWEEP = None  # no sweep.py: old_decisions imports ui-qa's scripts itself
LOOP = "ui-qa"
TZ = "America/Los_Angeles"  # the start window is the machine's local time


def _scripts():
    skills = Path(os.environ.get("PARITY_SKILLS_DIR") or Path.home() / ".agents" / "skills")
    folder = str(skills / "ui-qa" / "scripts")
    if folder not in sys.path:
        sys.path.insert(0, folder)
    import loop  # noqa: E402
    import pilot_mode  # noqa: E402

    return loop, pilot_mode


def _case(gate):
    try:
        return gate.load("parity", "case.json") or {}
    except NotInFixture:
        return {}


def nights(loop, pilot_mode, cases):
    out = []
    for n, night in enumerate(cases):
        outcome = pilot_mode.classify(night["stack"], night["test"], night.get("finished"))
        if night.get("renderFailed"):
            outcome = "render_failed"
        tested = loop.counts_as_tested(outcome, night["nothing"])
        out.append({"key": f"night:{n}", "label": night["name"], "decision": outcome, "reason": "tested" if tested else "retried"})
    return out


def _plan(loop, gate, now):
    """loop.plan(now) without saving baselines, with the answers waiting in each branch's note from the case."""
    try:
        waiting = gate.load("parity", "answers.json") or {}
    except NotInFixture:
        waiting = {}  # a live recording: its notes aren't in the case (Task 47b compares those)
    notes = {str(loop.vault.branch_note(LOOP, branch)): count for branch, count in waiting.items()}

    def answers_pending(note, now=None, settle=True):
        return ["answered"] * notes.get(str(note), 0)

    with mock.patch.object(gate, "answers_pending", answers_pending):
        return loop.plan(now, save_baselines=False)


def old_decisions(sweep, gate):
    os.environ["TZ"] = TZ
    time.tzset()
    loop, pilot_mode = _scripts()
    case = _case(gate)
    if case.get("nights"):
        return nights(loop, pilot_mode, case["nights"])
    now = time.time()
    run = loop.runstate.load_run()
    state = loop.current_state(run, now)
    if state not in ("idle", "active"):
        raise ValueError(f"a {state} run: the sweep closes it out before it decides; not a decision case")
    rows = _plan(loop, gate, now)
    active = run["worktree"]["path"] if state == "active" else None
    in_window = loop.runstate.may_start(now)
    first = next((wt for wt, status, _ in rows if status == "due"), None)
    quota = codex_over(gate) if first is not None and in_window and not active else None
    out = []
    for wt, status, detail in rows:
        word, reason = status, detail if isinstance(detail, str) else ""
        if active and wt["path"] == active:
            word, reason = "held_active", ""
        elif status == "due" and active:
            word = "held"
        elif status == "due" and not in_window:
            word = "outside"
        elif status == "due" and wt is first and quota:
            word, reason = "QUOTA", quota
        elif status == "due":
            word = "start" if wt is first else "queued"
        out.append({"key": f"wt:{wt['id']}", "label": wt.get("branch", ""), "decision": word, "reason": reason})
    return out


fixture_extras = repo_extras
