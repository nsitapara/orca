#!/usr/bin/env python3
"""Run one old sweep's plan for a job and print its per-item decisions as JSON, for Pilot's parity tests.

  run_old_plan.py <job> <fixture.json>                  replay: nothing runs; every read comes from the fixture
  run_old_plan.py <job> --record <out.json> [--case c]   record: allowlisted read-only commands run for real

<job> names an adapter in jobs/ (05 -> jobs/job_05.py). PARITY_SKILLS_DIR overrides ~/.agents/skills.
"""

import argparse
import importlib
import importlib.util
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # never leave __pycache__ in ~/.agents/skills
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import parity_io  # noqa: E402


def skills_dir():
    return Path(os.environ.get("PARITY_SKILLS_DIR") or Path.home() / ".agents" / "skills")


def load_sweep(skills, folder):
    """The sweep module, loaded from its file under a private name, with worktree-gate importable. An adapter whose
    job has no sweep.py sets SWEEP = None: only worktree-gate goes on sys.path, and the adapter gets None (it
    imports its own modules: quota.py, apply.py, review-cycles' loop.py, ui-qa's scripts)."""
    for path in (skills / "worktree-gate", *([skills / folder] if folder else [])):
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))
    if folder is None:
        return None
    spec = importlib.util.spec_from_file_location(f"parity_sweep_{folder.replace('-', '_')}", skills / folder / "sweep.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("job")
    ap.add_argument("fixture", nargs="?")
    ap.add_argument("--record", metavar="OUT")
    ap.add_argument("--case", default="")
    args = ap.parse_args(argv)
    if bool(args.fixture) == bool(args.record):
        ap.error("give a fixture to replay, or --record <out.json>")
    adapter = importlib.import_module(f"jobs.job_{args.job.lower()}")
    sweep = load_sweep(skills_dir(), adapter.SWEEP)
    import events
    import gate
    fixture = None if args.record else json.loads(Path(args.fixture).read_text())
    io = parity_io.ParityIO(gate, events, fixture=fixture)
    try:
        with io:
            decisions = adapter.old_decisions(sweep, gate)
            if io.recording and hasattr(adapter, "record_extras"):
                adapter.record_extras(gate, io)
    except (parity_io.NotInFixture, parity_io.ParityWriteBlocked) as e:
        print(f"parity: {e}", file=sys.stderr)
        return 2
    if args.record:
        extras = adapter.fixture_extras(gate) if hasattr(adapter, "fixture_extras") else {}
        Path(args.record).write_text(json.dumps(io.fixture(args.job, args.case, extras), indent=1, sort_keys=True) + "\n")
    print(json.dumps({"job": args.job, "decisions": decisions}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
