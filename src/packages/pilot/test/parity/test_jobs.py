"""Job adapters: what they record beyond the old plan's own reads, because Pilot's tick reads it too."""

import subprocess
import types
import unittest

from jobs import job_05


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
        gate = types.SimpleNamespace(REPO_ID="r", IN_PROGRESS=("MERGE_HEAD", "index.lock"), git=git,
                                     my_open_mrs=lambda: [{"source_branch": "a"}, {"source_branch": "b"}, {"source_branch": "a2"}],
                                     orca=lambda *args: {"worktrees": listed} if args == ("worktree", "list") else None)
        job_05.record_extras(gate, None)
        self.assertEqual(calls, [
            ("/wt/a", "status", "--porcelain"),
            ("/wt/a", "rev-parse", "--git-path", "MERGE_HEAD"),
            ("/wt/a", "rev-parse", "--git-path", "index.lock"),
            ("/wt/b", "status", "--porcelain"),
            ("/wt/b", "rev-parse", "--git-path", "MERGE_HEAD"),
        ])


if __name__ == "__main__":
    unittest.main()
