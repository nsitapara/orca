"""12 · Apply my answers (worktree-gate/apply.py): its own routing, holds and session choice for the cases in
12-apply-answers.parity.test.ts, which ride in the fixture's state as parity/case.json ({routes, holds, sessions}). Keys:
route:<n> (tick:kept, tick:skipped, script:<left-out ids>, agent, agent:revise), hold:<n> (apply.busy's reason, then QUOTA or
claimed in start_agent's order, else go), session:<n> (resume, fork, new). 12 has no sweep.py, so SWEEP is None: run_old_plan.py
puts only worktree-gate on sys.path and hands old_decisions None.
"""

import os
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

SWEEP = None  # no sweep.py: apply.py is imported from worktree-gate


def route_word(apply, case):
    family = "question" if case["kind"] in ("question", "flagged", "default") else "action"
    item = {"kind": case["kind"], "family": family, "answer": case["answer"], "run_command": case.get("run", ""),
            "parts": [{"id": p["id"], "label": p["label"], "run": p.get("run", "")} for p in case.get("parts", [])]}
    how, outcome = apply.route(item)
    if how == "script":
        return "script:" + ",".join(outcome)
    return f"{how}:{outcome}" if outcome else how


def hold_word(apply, gate, case):
    tab = case.get("tab")
    terminals = [{"handle": "t1", "title": "Review cycle · claude", "connected": True, "agentIdentity": "claude",
                  "worktreePath": "/wt/a", "tabId": "tab", "leafId": "leaf"}] if tab else []
    with ExitStack() as stack:
        def patch(target, name, value):
            stack.enter_context(mock.patch.object(target, name, value))

        patch(gate, "in_flight", lambda path: case.get("inFlight"))
        patch(gate, "orca", lambda *a: {"terminals": terminals})
        patch(gate, "draft", lambda handle: "a half-typed answer" if tab and tab.get("typing") else "")
        patch(gate, "agent_states", lambda: {"tab:leaf": {"state": tab["state"]}} if tab else {})
        patch(gate, "tab_busy", lambda handle: False)
        reason = None if case.get("jobWide") else apply.busy("review-cycles", {"path": "/wt/a"})
    if reason:
        return reason
    if case.get("quotaOut"):
        return "QUOTA"
    if case.get("claimedBy"):
        return "claimed"
    return "go"


def session_word(apply, case):
    asked = case.get("asking")
    with tempfile.TemporaryDirectory() as tmp:
        found = None
        if case.get("transcript"):
            found = Path(tmp) / "t.jsonl"
            with found.open("wb") as f:
                f.truncate(case["transcript"]["bytes"])
            when = time.time() - case["transcript"]["ageMs"] / 1000  # time.time is the fixture's now under ParityIO
            os.utime(found, (when, when))
        with mock.patch.object(apply, "transcript", lambda agent, session: found):
            return apply.session_route(asked["agent"] if asked else None, asked["sessionId"] if asked else None, case["liveIdle"])


def old_decisions(sweep, gate):
    import apply  # worktree-gate is on sys.path (run_old_plan.load_sweep, SWEEP = None)

    case = gate.load("parity", "case.json")
    out = []
    for n, c in enumerate(case.get("routes", [])):
        out.append({"key": f"route:{n}", "label": f"route {n}", "decision": route_word(apply, c), "reason": ""})
    for n, c in enumerate(case.get("holds", [])):
        out.append({"key": f"hold:{n}", "label": c["name"], "decision": hold_word(apply, gate, c), "reason": ""})
    for n, c in enumerate(case.get("sessions", [])):
        out.append({"key": f"session:{n}", "label": c["name"], "decision": session_word(apply, c), "reason": ""})
    for c in case.get("known", []):
        out.append({"key": f"known:{c['n']}", "label": "known", "decision": route_word(apply, c), "reason": ""})
    out.append({"key": "known-session:0", "label": "launch args unknown", "decision": session_word(apply, case["sessions"][0]), "reason": ""})
    return out
