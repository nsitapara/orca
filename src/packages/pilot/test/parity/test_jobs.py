"""Job adapters: what they record beyond the old plan's own reads, because Pilot's tick reads it too."""

import subprocess
import types
import unittest

from unittest import mock

from jobs import job_03, job_05


class Job05RecordExtrasTest(unittest.TestCase):
    def test_reads_every_listed_mrs_worktree_facts_even_where_a_read_fails(self):
        calls = []

        def git(path, *args):
            calls.append((path, *args))
            if path == "/wt/b":
                raise subprocess.CalledProcessError(128, ["git", "-C", path, *args])
            return ".git/" + args[-1] if args[0] == "rev-parse" else ""

        listed = [{"repoId": "r", "path": "/wt/a", "branch": "refs/heads/a"},
                  {"repoId": "r", "path": "/wt/b", "branch": "refs/heads/b"},
                  {"repoId": "r", "path": "/wt/old", "branch": "refs/heads/a2", "isArchived": True},
                  {"repoId": "r", "path": "/wt/c", "branch": "refs/heads/c"},
                  {"repoId": "other", "path": "/x", "branch": "refs/heads/a"}]
        gate = types.SimpleNamespace(REPO_ID="r", IN_PROGRESS=("MERGE_HEAD", "index.lock"), git=git, PROJECT="p",
                                     my_open_mrs=lambda: [{"iid": 1, "source_branch": "a"}, {"iid": 2, "source_branch": "b"},
                                                          {"iid": 3, "source_branch": "a2"}],
                                     glab=lambda path: {}, glab_all=lambda path: [],
                                     orca=lambda *args: {"worktrees": listed} if args == ("worktree", "list") else None)
        job_05.record_extras(gate, None)
        self.assertEqual(calls, [
            ("/wt/a", "status", "--porcelain"),
            ("/wt/a", "rev-parse", "--git-path", "MERGE_HEAD"),
            ("/wt/a", "rev-parse", "--git-path", "index.lock"),
            ("/wt/b", "status", "--porcelain"),
            ("/wt/b", "rev-parse", "--git-path", "MERGE_HEAD"),
        ])

    def test_reads_what_the_mr_source_reads_of_every_listed_mr_even_where_a_read_fails(self):
        calls = []

        def glab(path):
            calls.append(path)
            if path.endswith("/1/approvals") or path == "projects/p/merge_requests/2":
                raise subprocess.CalledProcessError(1, ["glab", "api", path])
            return {"sha": "head1"} if path == "projects/p/merge_requests/1" else {}

        def glab_all(path):
            calls.append(f"all:{path}")
            return []

        gate = types.SimpleNamespace(REPO_ID="r", IN_PROGRESS=(), git=None, PROJECT="p", glab=glab, glab_all=glab_all,
                                     my_open_mrs=lambda: [{"iid": 1, "source_branch": "feature/x", "sha": "list1"},
                                                          {"iid": 2, "source_branch": "b", "sha": "list2"}],
                                     orca=lambda *args: {"worktrees": []})
        job_05.record_extras(gate, None)
        self.assertEqual(calls, [
            "projects/p/merge_requests/1/approvals",
            "all:projects/p/merge_requests/1/discussions",
            "projects/p/merge_requests?source_branch=feature%2Fx&per_page=100",
            "projects/p/merge_requests/1",
            "projects/p/repository/commits/head1",
            "projects/p/merge_requests/2/approvals",
            "all:projects/p/merge_requests/2/discussions",
            "projects/p/merge_requests?source_branch=b&per_page=100",
            "projects/p/merge_requests/2",
            "projects/p/repository/commits/list2",
        ])


class Job03RecordExtrasTest(unittest.TestCase):
    def test_reads_what_the_worktree_source_reads_of_every_listed_worktree_even_where_a_read_fails(self):
        calls = []

        def git(path, *args):
            calls.append((path, *args))
            if path == "/wt/b" and args[0] == "status":
                raise subprocess.CalledProcessError(128, ["git", "-C", path, *args])
            return {"rev-parse": f"{path}/.git/{args[-1]}" if args[1:2] == ("--git-path",) else "h" * 40}.get(args[0], "")

        def glab(path):
            calls.append(path)
            if path.endswith("source_branch=b&per_page=100"):
                raise subprocess.CalledProcessError(1, ["glab", "api", path])
            return [{"iid": 7, "state": "opened"}, {"iid": 6, "state": "merged"}]

        listed = [{"repoId": "r", "path": "/wt/a", "branch": "refs/heads/feature/a"},
                  {"repoId": "r", "path": "/wt/b", "branch": "refs/heads/b"},
                  {"repoId": "r", "path": "/wt/old", "branch": "refs/heads/old", "isArchived": True},
                  {"repoId": "r", "path": "/main", "branch": "refs/heads/dev"},
                  {"repoId": "other", "path": "/x", "branch": "refs/heads/a"}]
        gate = types.SimpleNamespace(REPO_ID="r", MAIN_CHECKOUT=job_03.Path("/main"), IN_PROGRESS=("MERGE_HEAD",), PROJECT="p",
                                     git=git, glab=glab, me=lambda: calls.append("user"),
                                     load=lambda loop, name: {"/wt/a": "a" * 40, "/wt/b": "b" * 40},
                                     orca=lambda *args: {"worktrees": listed})
        ancestor = {"/wt/a": 0, "/wt/b": 1}
        with mock.patch.object(job_03.Path, "exists", lambda self: True), \
             mock.patch.object(job_03.subprocess, "run", lambda argv: calls.append(tuple(argv)) or types.SimpleNamespace(returncode=ancestor[argv[2]])):
            job_03.record_extras(gate, None)
        self.assertEqual(calls, [
            "user",
            ("/wt/a", "status", "--porcelain"),
            ("/wt/a", "rev-parse", "--git-path", "MERGE_HEAD"),
            "projects/p/merge_requests?source_branch=feature%2Fa&per_page=100",
            "projects/p/merge_requests/7/approvals",
            ("/wt/a", "rev-parse", "HEAD"),
            ("git", "-C", "/wt/a", "merge-base", "--is-ancestor", "a" * 40, "h" * 40),
            ("/wt/a", "log", "--first-parent", "--no-merges", "--format=%H%x00%ct%x00%B%x1e", f"{'a' * 40}..HEAD"),
            ("/wt/b", "status", "--porcelain"),
            ("/wt/b", "rev-parse", "--git-path", "MERGE_HEAD"),
            "projects/p/merge_requests?source_branch=b&per_page=100",
            ("/wt/b", "rev-parse", "HEAD"),
            ("git", "-C", "/wt/b", "merge-base", "--is-ancestor", "b" * 40, "h" * 40),  # rewritten: no log
        ])


if __name__ == "__main__":
    unittest.main()
