"""06 · Address reviewer feedback on my MRs (mr-feedback-sweep): the decisions sweep.main() makes, without dispatching.

Words: due (a session would start), skip (the gate's reason), defer (past --max 3), quota (out at dispatch), absent (no
reviewer thread waiting on me: the sweep drops those without a word). Keys `mr:<iid>` (contract §3).
"""

from jobs.common import quota_over
from jobs.job_05 import fixture_extras, record_extras  # noqa: F401  (the MR source's reads and the worktree facts Pilot also makes)

SWEEP = "mr-feedback-sweep"
MAX = 3  # sweep.py --max default


def _key(mr):
    return f"mr:{mr['iid']}"


def old_decisions(sweep, gate):
    me = gate.me()
    mrs = gate.my_open_mrs()
    worktrees = {
        w["branch"].removeprefix("refs/heads/"): w
        for w in gate.orca("worktree", "list")["worktrees"]
        if w["repoId"] == gate.REPO_ID and not w.get("isArchived")
    }
    busy = gate.open_tabs(sweep.LOOP)
    out, started = [], 0
    for mr in sorted(mrs, key=lambda m: m["iid"]):
        iid, branch = mr["iid"], mr["source_branch"]
        threads = sweep.waiting(gate.glab_all(f"projects/{gate.PROJECT}/merge_requests/{iid}/discussions"), me, sweep.head_commit_at(mr))
        if not threads:
            out.append({"key": _key(mr), "label": f"!{iid} {branch}", "decision": "absent", "reason": "no thread waiting on me"})
            continue
        label, wt = f"!{iid} {branch} ({threads} waiting)", worktrees.get(branch)
        decision, reason = "due", ""
        if not wt:
            decision, reason = "skip", "no Orca worktree"
        elif wt["path"] in busy:
            decision, reason = "skip", f"previous feedback session still open ({wt.get('comment') or 'no comment'})"
        elif why := gate.in_flight(wt["path"]):
            decision, reason = "skip", f"{why}; retry next round"
        elif started >= MAX:
            decision, reason = "defer", f"--max {MAX} reached"
        elif over := quota_over(gate, "claude"):
            decision, reason = "quota", over
        if decision == "due":
            started += 1
        out.append({"key": _key(mr), "label": label, "decision": decision, "reason": reason})
    return out
