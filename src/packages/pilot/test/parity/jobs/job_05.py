"""05 · Fix failed CI on my MRs (ci-fix-sweep): the decisions sweep.main() makes, without dispatching anything.

Words: due (would start), skip (plan's reason), defer (past --max 3), absent (plan didn't list it: head pipeline
not failed, or that pipeline already handled).
"""

from pathlib import Path

SWEEP = "ci-fix-sweep"
MAX = 3  # sweep.py --max default


def _key(mr):
    return f"mr:{mr['iid']}"


def _label(mr):
    return f"!{mr['iid']} {mr['source_branch']}"


def _why_absent(mr, handled):
    pipeline = mr.get("head_pipeline") or {}
    if pipeline.get("status") != "failed":
        return f"head pipeline {pipeline.get('status') or 'missing'}"
    return f"already handled pipeline {handled.get(str(mr['iid']))}"


def old_decisions(sweep, gate):
    listed = gate.my_open_mrs()
    mrs = [gate.glab(f"projects/{gate.PROJECT}/merge_requests/{m['iid']}") for m in listed]
    worktrees = {wt["branch"]: wt for wt in gate.worktrees(include_finished=True)}
    handled = gate.load(sweep.LOOP, "handled.json")
    out, started, planned = [], 0, set()
    for mr, _wt, status, detail in sweep.plan(mrs, worktrees, gate.open_tabs(sweep.LOOP), handled):
        planned.add(mr["iid"])
        if status == "skip":
            out.append({"key": _key(mr), "label": _label(mr), "decision": "skip", "reason": detail})
        elif started >= MAX:
            out.append({"key": _key(mr), "label": _label(mr), "decision": "defer", "reason": f"--max {MAX} reached"})
        else:
            started += 1
            out.append({"key": _key(mr), "label": _label(mr), "decision": "due", "reason": ""})
    for mr in mrs:
        if mr["iid"] not in planned:
            out.append({"key": _key(mr), "label": _label(mr), "decision": "absent", "reason": _why_absent(mr, handled)})
    return sorted(out, key=lambda d: int(d["key"].split(":")[1]))


def record_extras(gate, io):
    """Pilot reads the git-operation markers of every worktree whose status it reads; the old side stops at a dirty one."""
    paths = sorted({r["argv"][2] for r in io.reads if r["argv"][:2] == ["git", "-C"] and r["argv"][3:] == ["status", "--porcelain"]})
    for path in paths:
        for marker in gate.IN_PROGRESS:
            Path(path, gate.git(path, "rev-parse", "--git-path", marker)).exists()


def fixture_extras(gate):
    return {"repo": {"id": gate.REPO_ID, "path": str(gate.MAIN_CHECKOUT), "name": "web-platform",
                     "project": "polygenx/web-platform", "host": gate.GITLAB_HOST}}
