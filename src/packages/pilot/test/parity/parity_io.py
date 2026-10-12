"""Record or replay the outside reads an old sweep's plan makes, for Pilot's parity tests.

record  allowlisted read-only commands run for real and are saved; anything else raises ParityWriteBlocked before
        it runs (R18: GET-only).
replay  nothing runs; every read is answered from the fixture, and a read it lacks raises NotInFixture.
Either way gate.load is saved or replayed and gate.save refuses, events go nowhere, and gate's GitLab cache is
bypassed (it would write mr-cache.json).
"""

import json
import os
import pathlib
import subprocess
import time

ORCA_READS = {("worktree", "list"), ("worktree", "show"), ("worktree", "ps"), ("terminal", "list"),
              ("terminal", "show"), ("terminal", "read"), ("terminal", "wait"), ("repo", "list"), ("repo", "show"),
              ("linear", "list"), ("linear", "issue"), ("linear", "search"), ("status",)}
GLAB_READS = {("mr", "list"), ("mr", "view"), ("ci", "list"), ("ci", "view"), ("auth", "status")}
GLAB_WRITE_FLAGS = {"-f", "-F", "--field", "--raw-field", "--input"}
GIT_READS = {"status", "rev-parse", "log", "show-ref", "merge-base", "rev-list", "for-each-ref", "cat-file",
             "ls-files", "show"}
ENV_DROPPED = ("AGENT_RUN", "AGENT_TRIGGER", "AGENT_STEP")


class ParityWriteBlocked(BaseException):
    """A command that might change something; the recorder never runs it. A BaseException, so no sweep's
    `except Exception` (or its RuntimeError/KeyError handlers) can swallow it."""


class NotInFixture(BaseException):
    """A read the fixture lacks: re-record the case, or add the read to the job adapter's record_extras. A
    BaseException for the same reason."""


def _glab_is_read(rest):
    if rest[:1] == ["api"]:
        for i, arg in enumerate(rest):
            if arg in GLAB_WRITE_FLAGS:
                return False
            if arg in ("-X", "--method"):
                if i + 1 >= len(rest) or rest[i + 1].upper() != "GET":
                    return False
            elif arg.startswith("--method=") and arg.split("=", 1)[1].upper() != "GET":
                return False
        return True
    return tuple(rest[:2]) in GLAB_READS


def _git_is_read(rest):
    while rest[:1] in (["-C"], ["-c"]):
        rest = rest[2:]
    if not rest:
        return False
    sub, args = rest[0], rest[1:]
    if sub == "branch":
        return all(a in ("--show-current", "--list") for a in args)
    if sub == "config":
        return args[:1] == ["--get"]
    if sub == "diff":
        return not any(a.startswith("--output") for a in args)
    return sub in GIT_READS


def is_read(argv):
    """True only for commands known to read and never write."""
    if not isinstance(argv, (list, tuple)) or not argv or not all(isinstance(a, str) for a in argv):
        return False
    tool, rest = os.path.basename(argv[0]), list(argv[1:])
    if tool == "glab":
        return _glab_is_read(rest)
    if tool == "git":
        return _git_is_read(rest)
    if tool == "orca":
        words = tuple(a for a in rest if not a.startswith("-"))
        return words[:2] in ORCA_READS or words[:1] in ORCA_READS
    return False


def _stdout(entry):
    if "stdout" in entry:
        return entry["stdout"]
    if "json" in entry:
        return json.dumps(entry["json"])
    return ""


def _completed(argv, entry, kw):
    if entry.get("timeout"):
        raise subprocess.TimeoutExpired(argv, kw.get("timeout") or 0)
    stdout, stderr = _stdout(entry), entry.get("stderr", "")
    if not (kw.get("text") or kw.get("universal_newlines") or kw.get("encoding")):
        stdout, stderr = stdout.encode(), stderr.encode()
    code = entry.get("code", 0)
    if kw.get("check") and code != 0:
        raise subprocess.CalledProcessError(code, argv, stdout, stderr)
    return subprocess.CompletedProcess(argv, code, stdout, stderr)


def _uncached(cache_name, key, max_age, fetch, stale_ok=False):
    """gate._gitlab_cached without its cache file: fetch now, and fail the way it does when GitLab can't say."""
    try:
        return fetch()
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired, subprocess.CalledProcessError,
            RuntimeError) as e:
        raise RuntimeError(str(e)) from e


def _nothing(*a, **k):
    return None


def _refuse(*a, **k):
    raise ParityWriteBlocked(f"refused: {a!r}")


class ParityIO:
    """A context manager that patches one plan run's outside reads, and restores everything on exit."""

    def __init__(self, gate, events, fixture=None, real_run=None):
        self.gate, self.events = gate, events
        self.recording = fixture is None
        source = fixture or {}
        self.reads = list(source.get("reads", []))
        self.state = dict(source.get("state", {}))
        self.exists = dict(source.get("exists", {}))
        self.now = source["now"] if fixture is not None else int(time.time() * 1000)
        self._real_run = real_run or subprocess.run
        self._index = {tuple(r["argv"]): r for r in self.reads}
        self._undo = []

    def __enter__(self):
        real_exists, real_load, real_popen = pathlib.Path.exists, self.gate.load, subprocess.Popen
        self._patch(subprocess, "run", self._run)
        self._patch(subprocess, "Popen", self._guarded_popen(real_popen))
        self._patch(os, "system", _refuse)
        self._patch(os, "popen", _refuse)
        self._patch(pathlib.Path, "exists", self._exists(real_exists))
        self._patch(self.gate, "load", self._load(real_load))
        self._patch(self.gate, "save", _refuse)
        self._patch(self.gate, "event", _nothing)
        self._patch(self.gate, "decide", _nothing)
        self._patch(self.gate, "_gitlab_cached", _uncached)
        self._patch(self.events, "event", _nothing)
        if not self.recording:
            self._patch(time, "time", lambda: self.now / 1000)
        for name in ENV_DROPPED:
            if name in os.environ:
                value = os.environ.pop(name)
                self._undo.append(lambda name=name, value=value: os.environ.__setitem__(name, value))
        return self

    def __exit__(self, *exc):
        while self._undo:
            self._undo.pop()()
        return False

    def fixture(self, job, case, extras=None):
        return {"job": job, "case": case, "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "now": self.now,
                **(extras or {}), "reads": self.reads, "state": self.state, "exists": self.exists}

    def _patch(self, owner, name, value):
        old = getattr(owner, name)
        setattr(owner, name, value)
        self._undo.append(lambda: setattr(owner, name, old))

    def _run(self, args, *a, **kw):
        argv = list(args) if isinstance(args, (list, tuple)) else args
        if self.recording:
            if kw.get("shell") or not is_read(argv):
                raise ParityWriteBlocked(f"not a known read, so it isn't run: {argv!r}")
            entry = self._record(argv, kw)
        else:
            entry = self._index.get(tuple(argv)) if isinstance(argv, list) else None
            if entry is None:
                raise NotInFixture(f"not in the fixture: {argv!r}")
        return _completed(argv, entry, kw)

    def _record(self, argv, kw):
        if tuple(argv) in self._index:
            return self._index[tuple(argv)]
        try:
            done = self._real_run(argv, capture_output=True, text=True, timeout=kw.get("timeout") or 120)
            entry = {"argv": argv, "code": done.returncode, "stdout": done.stdout, "stderr": done.stderr}
        except subprocess.TimeoutExpired:
            entry = {"argv": argv, "timeout": True}
        self.reads.append(entry)
        self._index[tuple(argv)] = entry
        return entry

    def _guarded_popen(self, real):
        def popen(args, *a, **k):
            argv = list(args) if isinstance(args, (list, tuple)) else args
            if not self.recording or k.get("shell") or not is_read(argv):
                raise ParityWriteBlocked(f"not a known read, so it isn't run: {argv!r}")
            return real(args, *a, **k)
        return popen

    def _exists(self, real):
        def exists(path, *a, **k):
            key = str(path)
            if not os.path.isabs(key):
                return real(path, *a, **k)
            if self.recording:
                self.exists[key] = bool(real(path, *a, **k))
            elif key not in self.exists:
                raise NotInFixture(f"not in the fixture: exists {key}")
            return self.exists[key]
        return exists

    def _load(self, real):
        def load(loop, name):
            key = f"{loop}/{name}"
            if self.recording:
                self.state[key] = real(loop, name)
            elif key not in self.state:
                raise NotInFixture(f"not in the fixture: state {key}")
            return json.loads(json.dumps(self.state[key]))  # a copy: the sweep may change what it loaded
        return load
