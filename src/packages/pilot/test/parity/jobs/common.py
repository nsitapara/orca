"""What the Part G job adapters share: the quota gate, replayed from a fixture's saved reading."""

from parity_io import NotInFixture

LOOP_QUOTA = "quota"


def quota_over(gate, agent):
    """gate.require_quota(<agent>) on the case's saved reading (state `quota/<agent>.json`: {weekly, session} in
    percent): the reason when a limit is at its ceiling (quota.CEILING, >=), else None. A case without a reading, or
    with a limit missing, is an unreadable quota, which lets the job run."""
    import quota

    try:
        saved = gate.load(LOOP_QUOTA, f"{agent}.json") or {}
    except NotInFixture:
        return None
    limits = [{"name": name, "percent": saved[name], "resets_at": None} for name in ("weekly", "session") if saved.get(name) is not None]
    reason = quota.out_reason(limits)
    return f"{agent} {reason}" if reason else None


def codex_over(gate):
    """gate.require_quota("codex") on the case's raw Codex answer (state `quota/codex-rate-limits.json`; None:
    unreadable, which lets the job run)."""
    import quota

    try:
        raw = gate.load(LOOP_QUOTA, "codex-rate-limits.json")
    except NotInFixture:
        return None
    reason = quota.out_reason(quota.codex_limits(raw)) if raw else None
    return f"codex {reason}" if reason else None


def record_markers(gate, io):
    """Pilot reads the git-operation markers of every worktree whose status it reads; the old side stops at a dirty one."""
    from pathlib import Path

    paths = sorted({r["argv"][2] for r in io.reads if r["argv"][:2] == ["git", "-C"] and r["argv"][3:] == ["status", "--porcelain"]})
    for path in paths:
        for marker in gate.IN_PROGRESS:
            Path(path, gate.git(path, "rev-parse", "--git-path", marker)).exists()


def repo_extras(gate):
    return {"repo": {"id": gate.REPO_ID, "path": str(gate.MAIN_CHECKOUT), "name": "web-platform",
                     "project": "polygenx/web-platform", "host": gate.GITLAB_HOST}}
