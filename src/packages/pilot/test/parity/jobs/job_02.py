"""02 · Merge dev into my MR branches: the gate of its precheck, `quota.py check codex`, on a case's saved Codex answer.

codex_hooks.py trust ran first and always exited 0, so it never decided anything. Words: due (the job runs), quota
(quota.py says Codex is out). The only item is the run-once repo item `repo:web-platform`.
The case keeps Codex's raw `account/rateLimits/read` answer in state `quota/codex-rate-limits.json` (null: unreadable).
"""

SWEEP = None  # 02 has no sweep.py: quota.py is its whole gate
KEY, LABEL = "repo:web-platform", "web-platform"


def old_decisions(sweep, gate):
    import quota

    raw = gate.load("quota", "codex-rate-limits.json")
    if raw is None:
        return [{"key": KEY, "label": LABEL, "decision": "due", "reason": "limits unreadable, running anyway"}]
    reason = quota.out_reason(quota.codex_limits(raw))
    if reason:
        return [{"key": KEY, "label": LABEL, "decision": "quota", "reason": f"codex {reason}"}]
    return [{"key": KEY, "label": LABEL, "decision": "due", "reason": ""}]
