"""13 · Fix red hourly e2e on dev (dev-e2e-fix/sweep.py): the decisions its retry loop, plan() and act() make, without
writing anything. Decisions: pipeline:<id> green | seen | act | QUOTA | FAIL; linear:<ID> start | QUOTA | FAIL |
has_session | closed. It adds one script_check entry per open ticket: pilot_mode.check_worktree's verdict under the same
inputs, which is the check dev-e2e-fix-start.yaml runs (reason "" = it passes).

Every read (GitLab, Linear, Orca worktrees, git, saved state) comes from the case, through ParityIO, as in the other
adapters. What the sweep writes (state files, Linear, worktrees, tabs) is held in memory or dropped; a ticket this pass
opens is not started here, because Pilot's start automation picks it up at its next tick.
"""

import io
import json
import subprocess
from contextlib import ExitStack
from unittest import mock

from jobs.common import quota_over, repo_extras
from parity_io import is_read

SWEEP = "dev-e2e-fix"


class Linear:
    """Stands in for Linear: opens WEB-NEW<n> and ignores comments."""

    def __init__(self):
        self.opened = 0

    def comment(self, ident, body):
        pass

    def create(self, name, body):
        self.opened += 1
        return f"WEB-NEW{self.opened}", f"web-new{self.opened}-fix"


def old_decisions(sweep, gate):
    import pilot_mode  # the skill's folder is on sys.path (run_old_plan.load_sweep)

    said, local = [], {}
    io_load, io_run, real_orca = gate.load, subprocess.run, sweep.orca

    def load(loop, name):
        key = (loop, name)
        return json.loads(json.dumps(local[key])) if key in local else io_load(loop, name)

    def save(loop, name, data):
        local[(loop, name)] = json.loads(json.dumps(data))

    def run(args, *a, **k):  # reads reach ParityIO; anything that could write (git fetch) is a no-op
        if is_read(args):
            return io_run(args, *a, **k)
        return mock.Mock(returncode=0, stdout="", stderr="")

    def orca(*args):
        if args[:2] in (("worktree", "list"), ("linear", "issue")):
            return real_orca(*args)
        return {"worktree": {"path": "/wt/new"}, "agentTerminalHandle": "term_new"}

    def require_quota(agent):
        if agent == "claude" and (over := quota_over(gate, "claude")):
            raise gate.QuotaOut(over)

    with ExitStack() as stack:
        def patch(target, name, value):
            stack.enter_context(mock.patch.object(target, name, value))

        patch(gate, "load", load)
        patch(gate, "save", save)
        patch(gate, "decide", lambda skill, verdict, label, detail="", branch=None, out=print: said.append((label, verdict, detail)))
        patch(gate, "require_quota", require_quota)
        patch(gate, "open_tab", lambda *a, **k: "term_parity")
        patch(gate, "send_prompt", lambda *a, **k: None)
        patch(subprocess, "run", run)
        patch(sweep, "orca", orca)
        patch(sweep.usage, "record", lambda *a, **k: None)
        patch(sweep.vault, "add_run_line", lambda *a, **k: None)
        patch(sweep, "excerpts_for", lambda jobs: {})  # job traces: only the ticket's text
        patch(sweep, "merged_between", lambda green, red: [])  # a git fetch and log: only the ticket's text
        patch(sweep, "find_fix", lambda *a, **k: None)  # open MRs that may already fix the red: GitLab reads the cases predate
        patch(pilot_mode, "in_flight", gate.in_flight)  # pilotcli's idle rule, answered from the case's git reads as start() is

        quiet = lambda line: None  # noqa: E731
        recorded = load(sweep.LOOP, "tickets.json")
        tickets = sweep.open_tickets({i: e for i, e in recorded.items() if not e.get("closed")}, quiet)
        for ident, entry in sorted(tickets.items()):
            if not entry.get("path"):
                sweep.start_logged(ident, entry, quiet)
        latest, green = sweep.latest_and_green(sweep.children(), sweep.jobs_of)
        step = sweep.plan(latest, load(sweep.LOOP, "handled.json"), {i: e["jobs"] for i, e in tickets.items()})
        if step["action"] == "act":
            sweep.act(latest[0], latest[1], green, step, False, quiet, linear=Linear(), start=False)
        after = load(sweep.LOOP, "tickets.json")
        checks = []
        for ident in sorted(tickets):
            err = io.StringIO()
            code = pilot_mode.check_worktree({"ticket.id": ident, "ticket.branch": (after.get(ident) or {}).get("branch")}, err=err)
            checks.append({"key": f"linear:{ident}", "label": ident, "decision": "script_check",
                           "reason": "" if code == 0 else err.getvalue().strip()})
    return [*pipeline_decision(latest, step, said), *ticket_decisions(after, tickets, said), *checks]


def pipeline_decision(latest, step, said):
    if latest is None:
        return []
    label = f"pipeline {latest[0]['id']}"
    key = f"pipeline:{latest[0]['id']}"
    stopped = [(verdict, detail) for lab, verdict, detail in said if lab == label and verdict in ("QUOTA", "FAIL")]
    if stopped:
        return [{"key": key, "label": label, "decision": stopped[-1][0], "reason": stopped[-1][1]}]
    return [{"key": key, "label": label, "decision": step["action"], "reason": step.get("detail", "")}]


def ticket_decisions(recorded, tickets, said):
    out = []
    for ident, entry in sorted(recorded.items()):
        if ident.startswith("WEB-NEW"):
            continue  # opened in this pass; Pilot's start automation picks it up at its next tick
        key = {"key": f"linear:{ident}", "label": ident}
        if ident not in tickets:
            out.append({**key, "decision": "closed", "reason": ""})
            continue
        words = [(verdict, detail) for lab, verdict, detail in said if lab == ident and verdict in ("start", "QUOTA", "FAIL")]
        if words:
            out.append({**key, "decision": words[-1][0], "reason": words[-1][1]})
        elif entry.get("path"):
            out.append({**key, "decision": "has_session", "reason": ""})
    return out


fixture_extras = repo_extras
