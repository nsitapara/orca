"""M01 · Start my Todo Linear tickets (linear-todo-sweep): the decisions sweep.main() makes with --max 3, without starting
anything. Decisions per ticket (linear:<ID>): skip, start, defer, QUOTA, FAIL. It adds a script_check entry per Todo
ticket: sweep.check's verdict under the same reads, the check linear-todo.yaml runs (reason "" = it passes).

Every read (Linear, Orca worktrees and tabs, git, the MR owner, saved state) comes from the case, through ParityIO. What the
sweep does to start a ticket (create a worktree, open a tab, write started.json) is dropped.
"""

import io
import sys
from contextlib import ExitStack
from unittest import mock

from jobs.common import quota_over, repo_extras

SWEEP = "linear-todo-sweep"


def old_decisions(sweep, gate):
    said = []
    with ExitStack() as stack:
        def patch(target, name, value):
            stack.enter_context(mock.patch.object(target, name, value))

        def require_quota(agent):
            if agent == "claude" and (over := quota_over(gate, "claude")):
                raise gate.QuotaOut(over)

        patch(sweep, "log", lambda line: None)
        patch(sweep, "create", lambda issue: "/wt/new")
        patch(sweep, "dispatch", lambda issue, wt: None)
        patch(gate, "begin_run", lambda *a, **k: "M01a-parity")
        patch(gate, "decide", lambda skill, verdict, label, detail="", branch=None, out=print: said.append((label.split(" ")[0], verdict, detail)))
        patch(gate, "require_quota", require_quota)
        patch(sys, "argv", ["sweep.py", "--max", "3"])
        sweep.main()
        checks = []
        for found in sweep.assigned_unstarted():
            err = io.StringIO()
            item = {"key": f"linear:{found['identifier']}", "label": found["identifier"],
                    "fields": {"ticket.id": found["identifier"], "ticket.branch": found.get("branchName")}}
            code = sweep.check(item, err=err)
            checks.append({"key": item["key"], "label": item["label"], "decision": "script_check",
                           "reason": "" if code == 0 else err.getvalue().strip()})
    decisions = [{"key": f"linear:{ident}", "label": ident, "decision": verdict, "reason": detail} for ident, verdict, detail in said]
    return decisions + checks


fixture_extras = repo_extras
