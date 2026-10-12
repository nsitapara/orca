"""parity_io: replay never runs a process; record runs only reads, and saves them."""

import subprocess
import time
import types
import unittest
from pathlib import Path

from parity_io import NotInFixture, ParityIO, ParityWriteBlocked, is_read


def modules():
    gate = types.SimpleNamespace(load=lambda loop, name: {"from": "disk"}, save=lambda *a, **k: None,
                                 event=lambda *a, **k: None, decide=lambda *a, **k: None,
                                 _gitlab_cached=lambda *a, **k: None)
    return gate, types.SimpleNamespace(event=lambda *a, **k: None)


def never_run(*a, **k):
    raise AssertionError("replay ran a process")


FIXTURE = {
    "now": 1791738600000,
    "reads": [
        {"argv": ["glab", "api", "--hostname", "gitlab.com", "user"], "code": 0, "json": {"username": "nish8"}},
        {"argv": ["git", "-C", "/wt", "status", "--porcelain"], "code": 128, "stdout": "", "stderr": "fatal: not a git repository"},
    ],
    "state": {"ci-fix/handled.json": {"104": 9104}},
    "exists": {"/wt": True},
}


class IsReadTest(unittest.TestCase):
    def test_reads_and_writes(self):
        cases = [
            (["glab", "api", "--hostname", "gitlab.com", "projects/p/merge_requests"], True),
            (["glab", "api", "-X", "GET", "user"], True),
            (["glab", "api", "-X", "POST", "projects/p/merge_requests/1/notes"], False),
            (["glab", "api", "projects/p/merge_requests/1/notes", "-f", "body=hi"], False),
            # glab api writes once any field or input is given, whatever form the flag takes (R18).
            (["glab", "api", "p", "--field=body=x"], False),
            (["glab", "api", "p", "--raw-field=x"], False),
            (["glab", "api", "p", "--input=file"], False),
            (["glab", "api", "p", "--input", "file"], False),
            (["glab", "api", "p", "-fbody=x"], False),
            (["glab", "api", "p", "-Fx=y"], False),
            (["glab", "api", "-XPOST", "p"], False),
            (["glab", "api", "-X=GET", "p"], False),
            (["glab", "api", "-X", "get", "p"], False),
            (["glab", "api", "-X"], False),
            (["glab", "api", "--method", "PATCH", "p"], False),
            (["glab", "api", "--method=DELETE", "p"], False),
            (["glab", "api", "--method"], False),
            (["glab", "api", "-XGET", "user"], True),
            (["glab", "api", "--method", "GET", "user"], True),
            (["glab", "api", "--method=GET", "user"], True),
            # git log, show and diff write a file with --output.
            (["git", "-C", "/wt", "log", "--output=/tmp/x"], False),
            (["git", "-C", "/wt", "show", "--output", "/tmp/x", "HEAD"], False),
            (["git", "-C", "/wt", "diff", "--output=/tmp/x"], False),
            (["git", "-C", "/wt", "log", "-1", "--format=%ct"], True),
            (["git", "-C", "/wt", "show", "HEAD:a.txt"], True),
            (["glab", "mr", "list", "--source-branch", "b"], True),
            (["glab", "mr", "merge", "1"], False),
            (["git", "-C", "/wt", "status", "--porcelain"], True),
            (["git", "-C", "/wt", "fetch", "origin"], False),
            (["git", "-C", "/wt", "branch", "--show-current"], True),
            (["git", "-C", "/wt", "branch", "-D", "x"], False),
            (["orca", "worktree", "list", "--json"], True),
            (["orca", "worktree", "set", "--worktree", "id:x", "--comment", "c"], False),
            (["orca", "terminal", "send", "--terminal", "t", "--text", "x"], False),
            ("glab api user", False),
            (["rm", "-rf", "/"], False),
        ]
        for argv, expected in cases:
            with self.subTest(argv=argv):
                self.assertEqual(is_read(argv), expected)


class ReplayTest(unittest.TestCase):
    def test_answers_a_recorded_read_without_running_anything(self):
        gate, events = modules()
        with ParityIO(gate, events, fixture=FIXTURE, real_run=never_run):
            done = subprocess.run(["glab", "api", "--hostname", "gitlab.com", "user"], capture_output=True, text=True, check=True)
        self.assertEqual(done.stdout, '{"username": "nish8"}')

    def test_a_failed_read_fails_the_caller_that_checks(self):
        gate, events = modules()
        with ParityIO(gate, events, fixture=FIXTURE, real_run=never_run):
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                subprocess.run(["git", "-C", "/wt", "status", "--porcelain"], capture_output=True, text=True, check=True)
        self.assertEqual(caught.exception.returncode, 128)

    def test_refuses_a_read_the_fixture_lacks(self):
        gate, events = modules()
        with ParityIO(gate, events, fixture=FIXTURE, real_run=never_run):
            with self.assertRaises(NotInFixture):
                subprocess.run(["glab", "api", "--hostname", "gitlab.com", "projects"], capture_output=True, text=True)

    def test_serves_state_paths_and_time_and_never_saves(self):
        gate, events = modules()
        with ParityIO(gate, events, fixture=FIXTURE, real_run=never_run):
            self.assertEqual(gate.load("ci-fix", "handled.json"), {"104": 9104})
            self.assertTrue(Path("/wt").exists())
            self.assertEqual(time.time(), 1791738600.0)
            with self.assertRaises(NotInFixture):
                Path("/elsewhere").exists()
            with self.assertRaises(ParityWriteBlocked):
                gate.save("ci-fix", "handled.json", {})

    def test_restores_everything_on_exit(self):
        gate, events = modules()
        real_run, real_load, real_time = subprocess.run, gate.load, time.time
        with ParityIO(gate, events, fixture=FIXTURE, real_run=never_run):
            pass
        self.assertIs(subprocess.run, real_run)
        self.assertIs(gate.load, real_load)
        self.assertIs(time.time, real_time)


class RecordTest(unittest.TestCase):
    def test_runs_an_allowlisted_read_once_and_saves_it(self):
        calls = []

        def fake_run(argv, **kw):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, "[]", "")

        gate, events = modules()
        io = ParityIO(gate, events, real_run=fake_run)
        argv = ["glab", "api", "--hostname", "gitlab.com", "projects/p/merge_requests"]
        with io:
            subprocess.run(argv, capture_output=True, text=True)
            subprocess.run(argv, capture_output=True, text=True)
            self.assertEqual(gate.load("ci-fix", "handled.json"), {"from": "disk"})
        self.assertEqual(calls, [argv])
        fixture = io.fixture("05", "t", {"repo": {"id": "r"}})
        self.assertEqual(fixture["reads"], [{"argv": argv, "code": 0, "stdout": "[]", "stderr": ""}])
        self.assertEqual(fixture["state"], {"ci-fix/handled.json": {"from": "disk"}})
        self.assertEqual(fixture["repo"], {"id": "r"})

    def test_blocks_writes_before_they_run(self):
        calls = []
        gate, events = modules()
        with ParityIO(gate, events, real_run=lambda argv, **kw: calls.append(argv)):
            for argv in (["git", "-C", "/wt", "fetch", "origin", "dev"], ["glab", "api", "-X", "POST", "x"],
                         ["orca", "worktree", "set", "--comment", "c"]):
                with self.subTest(argv=argv), self.assertRaises(ParityWriteBlocked):
                    subprocess.run(argv, capture_output=True, text=True)
            with self.assertRaises(ParityWriteBlocked):
                subprocess.run("echo hi", shell=True)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
