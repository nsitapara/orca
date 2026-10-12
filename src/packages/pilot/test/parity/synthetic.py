#!/usr/bin/env python3
"""The hand-built parity cases of the ported jobs (02, 05, 06, 09), written in Task 13a's fixture format.

  synthetic.py            rewrite every case's <job>/<case>.json
  synthetic.py --check    exit 1 when a committed case differs from what this file builds

A case is written here as the facts it stands for (MRs, worktrees, tabs, a quota reading); `build` turns them into the
reads both sides make, so the old sweep's replay and Pilot's dry tick see the same world. Edit a case here and rewrite
the JSON; never edit the JSON by hand. Each port task adds its cases below, above `main`. 05's older case
(synthetic-basic.json) is Task 13b's and isn't touched.
"""

import json
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = {"id": "400fee61-a463-4f76-894a-39861e906007", "path": "/Users/nishsitapara/Documents/web-platform",
        "name": "web-platform", "project": "polygenx/web-platform", "host": "gitlab.com"}
PROJECT = "projects/polygenx%2Fweb-platform"
MARKERS = ("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "index.lock")
NAMES = {"nish8": "Nish Sitapara", "shivan2418": "Emil Elgaard", "alex1craig": "Alex Craig", "jonathan.walker2": "Jonathan Walker"}
DONE = "2026-10-11T16:00:00.000Z"  # the head commit's time in the 06 cases


def mr(iid, *, branch=None, author="nish8", pipeline=None, draft=False, reviewers=(), title=None, changes="1",
       sha=None, approved_by=(), discussions=(), committed=DONE):
    """One MR as GitLab's detail read gives it. <pipeline> is (id, status) or None."""
    return {
        "iid": iid, "title": title or f"MR {iid}", "state": "opened", "draft": draft,
        "sha": sha or f"{iid}".ljust(40, "0"), "source_branch": branch or f"web-{iid}", "target_branch": "dev",
        "author": {"username": author, "name": NAMES[author]}, "reviewers": [{"username": u} for u in reviewers],
        "head_pipeline": {"id": pipeline[0], "status": pipeline[1]} if pipeline else None, "changes_count": changes,
        "_approved_by": list(approved_by), "_discussions": list(discussions), "_committed": committed,
    }


def note(author="alex1craig", at="15:00", kind="R-open", system=False):
    """One discussion note, written as `alex@15:00 R-open`: R-open/R-done are resolvable threads, top is a top-level note."""
    out = {"system": system, "author": {"username": author}, "resolvable": kind != "top",
           "created_at": f"2026-10-11T{at}:00.000Z"}
    if kind != "top":
        out["resolved"] = kind == "R-done"
    return out


def thread(iid, *notes):
    return {"id": f"d{iid}", "notes": list(notes)}


def worktree(name, branch, *, dirty=0, untracked=0, operation=None, comment=None, archived=False):
    return {"path": f"/wt/{name}", "branch": branch, "dirty": dirty, "untracked": untracked, "operation": operation,
            "comment": comment, "archived": archived}


def read(argv, **result):
    return {"argv": argv, "code": 0, **result}


def glab(path, body):
    return read(["glab", "api", "--hostname", REPO["host"], path], json=body)


def gitdir(path):
    return f"/parity-gitdirs{path}"


def git_reads(wt, reads, exists):
    path = wt["path"]
    porcelain = " M src/a.ts\n" * wt["dirty"] + "?? new.ts\n" * wt["untracked"]
    reads.append(read(["git", "-C", path, "status", "--porcelain"], stdout=porcelain, stderr=""))
    for marker in MARKERS:
        full = f"{gitdir(path)}/{marker}"
        reads.append(read(["git", "-C", path, "rev-parse", "--git-path", marker], stdout=f"{full}\n", stderr=""))
        exists[full] = wt["operation"] == marker


def api_mr(m):
    return {k: v for k, v in m.items() if not k.startswith("_")}


def listed(m):
    """The list endpoint leaves out head_pipeline; the detail read has it."""
    return {k: v for k, v in api_mr(m).items() if k != "head_pipeline"}


def build(job, name, *, now, mrs=None, listed_by="author", me="nish8", worktrees=(), terminals=(), loop=None,
          state=None, quota=None, branch_mrs=False):
    """The Task 13a fixture for one case. <mrs> None builds a case with no GitLab reads at all (02)."""
    reads, exists, kept = [], {}, dict(state or {})
    if mrs is not None:
        reads.append(glab("user", {"username": me}))
        mine = [m for m in mrs if (m["author"]["username"] == me if listed_by == "author" else me in {r["username"] for r in m["reviewers"]})]
        reads.append(glab(f"{PROJECT}/merge_requests?state=opened&{listed_by}_username={me}&per_page=100&page=1",
                          [listed(m) for m in sorted(mine, key=lambda m: m["iid"])]))
        for m in sorted(mrs, key=lambda m: m["iid"]):
            iid = m["iid"]
            reads.append(glab(f"{PROJECT}/merge_requests/{iid}", api_mr(m)))
            reads.append(glab(f"{PROJECT}/merge_requests/{iid}/approvals",
                              {"approved_by": [{"user": {"username": u}} for u in m["_approved_by"]]}))
            reads.append(glab(f"{PROJECT}/merge_requests/{iid}/discussions?per_page=100&page=1", m["_discussions"]))
            reads.append(glab(f"{PROJECT}/repository/commits/{m['sha']}", {"committed_date": m["_committed"]}))
        listing = [{"id": f"{REPO['id']}::{w['path']}", "repoId": REPO["id"], "path": w["path"],
                    "branch": f"refs/heads/{w['branch']}", "isArchived": w["archived"],
                    **({"comment": w["comment"]} if w["comment"] else {})} for w in worktrees]
        reads.append(read(["orca", "worktree", "list", "--json"], json={"ok": True, "result": {"worktrees": listing}}))
        reads.append(read(["orca", "terminal", "list", "--json"],
                          json={"ok": True, "result": {"terminals": [{"handle": h, "connected": True} for h in terminals]}}))
        for w in worktrees:
            if w["archived"]:
                continue
            exists[w["path"]] = True
            git_reads(w, reads, exists)
            if branch_mrs:
                same = [m for m in mrs if m["source_branch"] == w["branch"]]
                reads.append(read(["glab", "mr", "list", "--source-branch", w["branch"], "--all", "--output", "json", "--repo", REPO["project"]],
                                  json=[{"iid": m["iid"], "state": m["state"], "author": {"username": m["author"]["username"]},
                                         "web_url": f"https://gitlab.com/{REPO['project']}/-/merge_requests/{m['iid']}"} for m in same]))
        if branch_mrs:  # Pilot's MR source reads each listed MR's branch (the ownership blocks), worktree or not
            for branch in sorted({m["source_branch"] for m in mine}):
                reads.append(glab(f"{PROJECT}/merge_requests?source_branch={urllib.parse.quote(branch, safe='')}&per_page=100",
                                  [api_mr(m) for m in mrs if m["source_branch"] == branch]))
    if loop:
        kept.setdefault(f"{loop}/tabs.json", {})
        kept.setdefault(f"{loop}/tabs-codex.json", {})
    if quota:
        kept["quota/claude.json"] = quota
    return {"job": job, "case": name, "recordedAt": "synthetic", "now": now, "repo": REPO, "reads": reads,
            "state": kept, "exists": exists}


def dump(fixture):
    """JSON with one read, state key and exists key per line, so a case reads and diffs well."""
    def block(key, items):
        return [f' "{key}": [', ",\n".join("  " + json.dumps(i) for i in items), " ]"] if items else [f' "{key}": []']

    def mapping(key, d):
        return [f' "{key}": {{', ",\n".join(f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in sorted(d.items())), " }"] if d else [f' "{key}": {{}}']

    head = ",\n".join(f' "{k}": {json.dumps(fixture[k])}' for k in ("case", "job", "now", "recordedAt", "repo"))
    parts = [head, "\n".join(block("reads", fixture["reads"])), "\n".join(mapping("state", fixture["state"])),
             "\n".join(mapping("exists", fixture["exists"]))]
    return "{\n" + ",\n".join(parts) + "\n}\n"


CASE_MAKERS = []  # each port task appends the function that yields its cases as (job, name, fixture)


def cases():
    return [case for make in CASE_MAKERS for case in make()]


def _02():
    now = 1791712800000  # 03:00 Pacific, 2026-10-11

    def limits(primary=40, secondary=61, *, allowed=True, secondary_reset=1792000000):
        return {"rateLimits": {"primary": {"usedPercent": primary, "windowDurationMins": 300, "resetsAt": 1791730800},
                               "secondary": {"usedPercent": secondary, "windowDurationMins": 10080, "resetsAt": secondary_reset},
                               "rateLimitReachedType": None},
                "ordinaryUsageAllowed": allowed}

    raw = {
        "quota-ok": limits(),
        "weekly-at-ceiling": limits(secondary=90),
        "session-at-ceiling": limits(primary=95),
        "codex-says-out": limits(20, 30, allowed=False),
        "reset-passed": limits(secondary=97, secondary_reset=1791700000),
        "unreadable": None,
    }
    for name, answer in raw.items():
        fixture = build("02", name, now=now, state={"quota/codex-rate-limits.json": answer})
        # No GitLab reads, but the dry tick lists the repo's worktrees and terminals (none) for its main-checkout item.
        fixture["reads"] += [
            read(["orca", "worktree", "list", "--json"], json={"ok": True, "result": {"worktrees": []}}),
            read(["orca", "terminal", "list", "--json"], json={"ok": True, "result": {"terminals": []}}),
        ]
        yield "02", name, fixture


CASE_MAKERS.append(_02)


def _05():
    now = 1791659400000  # 12:10 Pacific, 2026-10-10
    failed = lambda iid, pid: (pid, "failed")  # noqa: E731
    mrs = [
        mr(1347, branch="web-1689-app-id", pipeline=(2934300001, "success"), changes="3"),
        mr(1561, branch="web-1493-confidence", pipeline=failed(1561, 2934410022), changes="4"),
        mr(1574, branch="web-1474-donor-status", pipeline=failed(1574, 2934398811), changes="6"),
        mr(1587, branch="web-2118-hourly-e2e", pipeline=failed(1587, 2933991087), draft=True, changes="2"),
        mr(1588, branch="web-2115-ecs-deps", author="shivan2418", pipeline=failed(1588, 2934411111)),
        mr(1590, branch="web-1690-filenames", pipeline=(2934400099, "running"), changes="2"),
        mr(1592, branch="staff-feature-usage-page", pipeline=failed(1592, 2934120075), draft=True, changes="9"),
        mr(1601, branch="web-2201-no-worktree", pipeline=failed(1601, 2934500001)),
        mr(1603, branch="web-2203-untracked", pipeline=failed(1603, 2934500003)),
        mr(1604, branch="web-2204-rebase", pipeline=failed(1604, 2934500004)),
        mr(1605, branch="web-2205-due", pipeline=failed(1605, 2934500005)),
        mr(1606, branch="web-2206-due", pipeline=failed(1606, 2934500006)),
        mr(1607, branch="web-2207-due", pipeline=failed(1607, 2934500007)),
    ]
    worktrees = [
        worktree("web-1689", "web-1689-app-id"), worktree("web-1493", "web-1493-confidence"),
        worktree("web-1474", "web-1474-donor-status", dirty=2), worktree("web-2118", "web-2118-hourly-e2e"),
        worktree("web-1690", "web-1690-filenames"), worktree("usage", "staff-feature-usage-page"),
        worktree("web-2203", "web-2203-untracked", untracked=1), worktree("web-2204", "web-2204-rebase", operation="rebase-merge"),
        worktree("web-2205", "web-2205-due"), worktree("web-2206", "web-2206-due"), worktree("web-2207", "web-2207-due"),
    ]
    yield "05", "2026-10-10-1210", build(
        "05", "2026-10-10-1210", now=now, mrs=mrs, worktrees=worktrees, terminals=["term_usage"], loop="ci-fix", branch_mrs=True,
        state={"ci-fix/handled.json": {"1587": 2933991087},
               "ci-fix/tabs.json": {"/wt/usage": "term_usage", "/wt/web-1493": "term_gone"}},
        quota={"weekly": 61, "session": 38})
    yield "05", "quota-out", build(
        "05", "quota-out", now=now, mrs=[m for m in mrs if m["iid"] in (1561, 1574)],
        worktrees=[w for w in worktrees if w["path"] in ("/wt/web-1493", "/wt/web-1474")], loop="ci-fix", branch_mrs=True,
        state={"ci-fix/handled.json": {}}, quota={"weekly": 91, "session": 38})


CASE_MAKERS.append(_05)


def main(argv):
    check = argv[1:] == ["--check"]
    stale = []
    for job, name, fixture in cases():
        path = HERE / job / f"{name}.json"
        text = dump(fixture)
        if check:
            if not path.exists() or json.loads(path.read_text()) != json.loads(text):  # parsed: the commit hook reformats the JSON
                stale.append(str(path))
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    if stale:
        print("stale (run synthetic.py):", *stale, sep="\n  ")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
