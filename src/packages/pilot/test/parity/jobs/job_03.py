"""03 · Review and fix branch code (review-cycles/loop.py).

Sweep decisions: loop.py's real sweep as the Orca job ran it (`sweep --push`, --max 2, not a dry run: quota counts) over
the case. Every read (Orca's worktrees and tabs, GitLab, git, the in-flight markers, the saved state) comes from the
case through ParityIO; what the sweep does (save state, open the note's cycle, send a tab its round, flag the card) is
kept here or dropped. Quota is the case's: Claude's saved reading (quota/claude.json) and Codex's raw answer
(quota/codex-rate-limits.json). One decision per worktree gate.worktrees() lists (wt:<id>): the sweep's last word for it
(base, skip, start after stale, defer, QUOTA), or nothing_new when it was listed and had no new commits, or parked when
its parked hand-off held it. A teammate's worktree, which gate.worktrees() never lists, gets no decision.

review-cycles has no sweep.py, so SWEEP is None and this adapter imports loop.py from review-cycles itself.
"""

import io
import os
import subprocess
import sys
import urllib.parse
from contextlib import ExitStack, redirect_stdout
from copy import deepcopy
from pathlib import Path
from unittest import mock

from jobs.common import codex_over, quota_over, repo_extras
from parity_io import is_read

SWEEP = None  # no sweep.py: old_decisions imports review-cycles' loop.py itself
LOOP = "standards"
MAX = 2  # loop.py sweep --max default
LOG_FORMAT = "--format=%H%x00%ct%x00%B%x1e"  # Pilot's worktree source reads the commits since the marker this way


def _loop():
    skills = Path(os.environ.get("PARITY_SKILLS_DIR") or Path.home() / ".agents" / "skills")
    folder = str(skills / "review-cycles")
    if folder not in sys.path:
        sys.path.insert(0, folder)
    import loop  # noqa: E402

    return loop


def _sweep(loop, gate):
    said, local = [], {}
    io_load, real_orca = gate.load, gate.orca

    def load(loop_name, name):
        if (loop_name, name) in local:
            return deepcopy(local[(loop_name, name)])
        return io_load(loop_name, name)

    def require_quota(agent):
        reason = quota_over(gate, "claude") if agent == "claude" else codex_over(gate)
        if reason:
            raise gate.QuotaOut(reason)

    with ExitStack() as stack:
        def patch(target, name, value):
            stack.enter_context(mock.patch.object(target, name, value))

        patch(gate, "load", load)
        patch(gate, "save", lambda loop_name, name, data: local.__setitem__((loop_name, name), deepcopy(data)))
        patch(gate, "orca", lambda *args: real_orca(*args) if is_read(["orca", *map(str, args)]) else {})
        patch(gate, "decide", lambda skill, verdict, label, detail="", branch=None, out=print: said.append((label, verdict, detail)))
        patch(gate, "begin_run", lambda *a, **k: "03a-parity")
        patch(gate, "require_quota", require_quota)
        patch(loop, "start", lambda *a, **k: None)
        patch(loop, "open_note_cycle", lambda *a, **k: "03a-parity")
        stack.enter_context(redirect_stdout(io.StringIO()))  # the sweep prints; run_old_plan.py prints the JSON
        cycles = gate.load(LOOP, "cycles.json")
        listed = list(gate.worktrees(include_finished=True))
        loop.sweep(False, MAX, push=True)
    last = {label: (verdict, detail) for label, verdict, detail in said}
    out = []
    for wt in listed:
        key = {"key": f"wt:{wt['id']}", "label": wt["branch"]}
        if wt["branch"] in last:
            verdict, detail = last[wt["branch"]]
            out.append({**key, "decision": verdict, "reason": detail})
        elif (cycles.get(wt["path"]) or {}).get("pending"):
            out.append({**key, "decision": "parked", "reason": ""})
        else:
            out.append({**key, "decision": "nothing_new", "reason": ""})
    return out


def old_decisions(sweep, gate):
    return _sweep(_loop(), gate)


def _try(read):
    try:
        return read()
    except (subprocess.CalledProcessError, RuntimeError, ValueError):
        return None  # recorded with its exit code: Pilot's read of it fails the same way


def record_extras(gate, io):
    """What Pilot's worktree source and worktree facts read of every worktree Orca lists for the repo, which the sweep
    reads only until something decides: git status and the git-operation markers, the branch's MRs through the API and
    each open MR's approvals, HEAD, whether the marker is still in its history, and the commits since it in Pilot's own
    log format."""
    seen = gate.load(LOOP, "seen.json")
    _try(gate.me)
    base = f"projects/{gate.PROJECT}"
    for wt in gate.orca("worktree", "list")["worktrees"]:
        path, branch = wt["path"], wt.get("branch", "").removeprefix("refs/heads/")
        if wt["repoId"] != gate.REPO_ID or wt.get("isArchived") or Path(path) == gate.MAIN_CHECKOUT or not Path(path).exists():
            continue
        _try(lambda: gate.git(path, "status", "--porcelain"))
        for marker in gate.IN_PROGRESS:
            _try(lambda marker=marker: Path(path, gate.git(path, "rev-parse", "--git-path", marker)).exists())
        mrs = _try(lambda: gate.glab(f"{base}/merge_requests?source_branch={urllib.parse.quote(branch, safe='')}&per_page=100")) or []
        for m in mrs:
            if m.get("state") == "opened":
                _try(lambda m=m: gate.glab(f"{base}/merge_requests/{m['iid']}/approvals"))
        head = _try(lambda: gate.git(path, "rev-parse", "HEAD"))
        since = seen.get(path)
        if not (head and since):
            continue
        if subprocess.run(["git", "-C", path, "merge-base", "--is-ancestor", since, head]).returncode == 0:
            _try(lambda: gate.git(path, "log", "--first-parent", "--no-merges", LOG_FORMAT, f"{since}..HEAD"))


fixture_extras = repo_extras
