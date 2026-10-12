"""synthetic.py: the cases it writes are the cases committed, and a case holds the reads both sides make."""

import unittest

import synthetic


class SyntheticTest(unittest.TestCase):
    def test_every_committed_case_is_what_the_builder_writes(self):
        self.assertEqual(synthetic.main(["synthetic.py", "--check"]), 0)

    def test_check_catches_a_value_that_only_looks_equal_in_python(self):
        # True == 1 and 1 == 1.0 in Python, but they are different JSON; --check must see the drift.
        import tempfile
        from pathlib import Path
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            for job, name, fixture in synthetic.cases():
                path = Path(tmp) / job / f"{name}.json"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(synthetic.dump(fixture))
            with mock.patch.object(synthetic, "HERE", Path(tmp)):
                self.assertEqual(synthetic.main(["synthetic.py", "--check"]), 0)
                target = next(Path(tmp).glob("05/*.json"))
                target.write_text(target.read_text().replace(": true", ": 1", 1))
                self.assertEqual(synthetic.main(["synthetic.py", "--check"]), 1)

    def test_a_case_holds_the_reads_of_the_old_sweep_and_of_pilots_dry_tick(self):
        wt = synthetic.worktree("w7", "web-7", dirty=1, operation="rebase-merge")
        fixture = synthetic.build("T", "c", now=5, mrs=[synthetic.mr(7, pipeline=(70, "failed"))], worktrees=[wt], loop="ci-fix",
                                  quota={"weekly": 61, "session": 38}, branch_mrs=True)
        reads = {tuple(r["argv"][4:] if r["argv"][:2] == ["glab", "api"] else r["argv"]): r for r in fixture["reads"]}
        project = "projects/polygenx%2Fweb-platform"
        self.assertEqual(reads[(f"{project}/merge_requests?state=opened&author_username=nish8&per_page=100&page=1",)]["json"][0]["iid"], 7)
        self.assertNotIn("head_pipeline", reads[(f"{project}/merge_requests?state=opened&author_username=nish8&per_page=100&page=1",)]["json"][0])
        self.assertEqual(reads[(f"{project}/merge_requests/7",)]["json"]["head_pipeline"], {"id": 70, "status": "failed"})
        self.assertEqual(reads[("git", "-C", "/wt/w7", "status", "--porcelain")]["stdout"], " M src/a.ts\n")
        gitdir = "/parity-gitdirs/wt/w7"
        self.assertEqual({k: v for k, v in fixture["exists"].items() if k.startswith(gitdir) and v}, {f"{gitdir}/rebase-merge": True})
        self.assertEqual(fixture["state"], {"ci-fix/tabs.json": {}, "ci-fix/tabs-codex.json": {}, "quota/claude.json": {"weekly": 61, "session": 38}})
        self.assertIn(("glab", "mr", "list", "--source-branch", "web-7", "--all", "--output", "json", "--repo", "polygenx/web-platform"), reads)

    def test_a_case_with_no_gitlab_reads_has_none(self):
        fixture = synthetic.build("T", "c", now=5, state={"quota/codex-rate-limits.json": None})
        self.assertEqual((fixture["reads"], fixture["state"]), ([], {"quota/codex-rate-limits.json": None}))


if __name__ == "__main__":
    unittest.main()
