#!/usr/bin/env python3
"""The hand-built parity cases of the ported jobs (02, 03, 05, 06, 09, 13, M01), written in Task 13a's fixture format.

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


def worktree(name, branch, *, dirty=0, untracked=0, operation=None, comment=None, archived=False, linked=None):
    return {"path": f"/wt/{name}", "branch": branch, "dirty": dirty, "untracked": untracked, "operation": operation,
            "comment": comment, "archived": archived, "linked": linked}


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


    # The order M1 got wrong: a tab still open AND a dirty worktree. The sweep tests the tab first.
    busy = mr(1610, branch="web-2210-tab-and-dirty", pipeline=failed(1610, 2934500010))
    yield "05", "tab-and-dirty", build(
        "05", "tab-and-dirty", now=now, mrs=[busy], worktrees=[worktree("web-2210", "web-2210-tab-and-dirty", dirty=1)],
        terminals=["term_busy"], loop="ci-fix", branch_mrs=True,
        state={"ci-fix/handled.json": {}, "ci-fix/tabs.json": {"/wt/web-2210": "term_busy"}}, quota={"weekly": 61, "session": 38})


CASE_MAKERS.append(_05)


def _06():
    now = 1791747600000  # 12:40 Pacific, 2026-10-11

    def request(iid, *threads, **extra):
        return mr(iid, reviewers=("alex1craig",), discussions=list(threads), **extra)

    def open_thread(iid):
        return thread(iid, note())

    clean = lambda iids: [worktree(f"web-{i}", f"web-{i}") for i in iids]  # noqa: E731
    well = {"weekly": 40, "session": 20}
    threads = [
        request(1700, open_thread(1700)),
        request(1701, thread(1701, note(kind="R-done"))),
        request(1702, thread(1702, note("nish8"), note(at="15:30"))),
        request(1703, thread(1703, note(), note("nish8", "15:30"))),
        request(1704, thread(1704, note(at="17:00", kind="top"))),
        request(1705, thread(1705, note(kind="top"))),
        request(1706, thread(1706, note(at="17:00", kind="top", system=True))),
    ]
    yield "06", "threads", build("06", "threads", now=now, mrs=threads, worktrees=clean(range(1700, 1707)), loop="mr-feedback",
                                 quota=well, branch_mrs=True)
    gates = [request(i, open_thread(i)) for i in range(1710, 1717)]
    yield "06", "gates", build(
        "06", "gates", now=now, mrs=gates, loop="mr-feedback", terminals=["term_fb"], quota=well, branch_mrs=True,
        worktrees=[worktree(f"web-{i}", f"web-{i}", untracked=2 if i == 1712 else 0) for i in range(1711, 1717)],
        state={"mr-feedback/tabs.json": {"/wt/web-1711": "term_fb"}})
    quota = [request(1720, open_thread(1720)), request(1721, thread(1721, note(kind="R-done")))]
    yield "06", "quota-out", build("06", "quota-out", now=now, mrs=quota, worktrees=clean((1720, 1721)), loop="mr-feedback",
                                   quota={"weekly": 40, "session": 96}, branch_mrs=True)
    # The sweep tests the open tab before the dirty worktree.
    busy = request(1730, open_thread(1730))
    yield "06", "tab-and-dirty", build(
        "06", "tab-and-dirty", now=now, mrs=[busy], worktrees=[worktree("web-1730", "web-1730", dirty=1)], terminals=["term_fb"],
        loop="mr-feedback", quota=well, branch_mrs=True, state={"mr-feedback/tabs.json": {"/wt/web-1730": "term_fb"}})


CASE_MAKERS.append(_06)


ITEMS_09 = """---
created: 2026-10-09T10:00
updated: 2026-10-11T09:30
---

# Prepare reviews requested of me

## 2026-10-10 09:30 · 09a-20261010T0930 · shell

- [x] **action** · Prepare a review of !1571? — `web-2097-fix-cves-schedule @12cace69` · ✓ skipped
  Run the fix-cves skill on a schedule · by Alex Craig · 7 files · head 12cace69. Nothing reaches GitLab until you approve the findings.
  Options: Approve — check the branch out in a worktree and prepare the review there; nothing posts yet | Skip — don't review this head
  Answer: skip
- [x] **action** · Prepare a review of !1579? — `web-2107-figaro-selector @815b3867` · ✓ prepared → 3a3f25b54519589a
  Improve source figaro run selector · by Jonathan Walker · 5 files · head 815b3867. Nothing reaches GitLab until you approve the findings.
  Options: Approve — check the branch out in a worktree and prepare the review there; nothing posts yet | Skip — don't review this head
  Answer: approve
"""


def _09():
    now = 1791747000000  # 12:30 Pacific, 2026-10-11
    me = ("nish8",)
    vault = lambda text: {"review-requests/vault.json": {"notes": {"09 \u00b7 Prepare reviews requested of me/Items.md": text}}}  # noqa: E731
    mrs = [
        mr(1571, branch="web-2097-fix-cves-schedule", author="alex1craig", reviewers=me, title="Run the fix-cves skill on a schedule",
           changes="7", sha="2b7e4c9".ljust(40, "0")),
        mr(1579, branch="web-2107-figaro-selector", author="jonathan.walker2", reviewers=me, title="Improve source figaro run selector",
           changes="5", sha="815b3867".ljust(40, "a")),
        mr(1580, branch="web-2110-donor-import", author="alex1craig", reviewers=me, title="Donor import fixes", changes="2",
           approved_by=("nish8",)),
        mr(1588, branch="web-2115-ecs-deps", author="shivan2418", reviewers=me, title="Stop ECS containers installing dev dependencies",
           approved_by=("alex1craig",)),
        mr(1592, branch="staff-feature-usage-page", reviewers=me, draft=True, title="Staff feature usage page", changes="9"),
        mr(1600, branch="web-1600-donor-status", author="alex1craig", reviewers=("nish8", "jonathan.walker2"), draft=True,
           title="Add donor status", changes="3", sha="1e3456789abcdef0".ljust(40, "0")),
        mr(1601, branch="web-1601-other", author="alex1craig", reviewers=("jonathan.walker2",), title="Not my review"),
    ]
    yield "09", "requests", build("09", "requests", now=now, mrs=mrs, listed_by="reviewer", branch_mrs=True, state=vault(ITEMS_09))
    # No cap: the sweep offered every head in one pass (no --max, no per-tick limit), six of them here.
    many = [mr(1800 + i, branch=f"web-18{i:02d}-many", author="alex1craig", reviewers=me, title=f"Change {i}", changes=str(i + 1))
            for i in range(6)]
    yield "09", "many", build("09", "many", now=now, mrs=many, listed_by="reviewer", branch_mrs=True, state=vault(ITEMS_09))
    # The sweep's order of reasons: my own MR before any approval; my approval before anybody's; a later head
    # after the approval is still approved. Heads already offered stay offered, a new head asks again.
    order = [
        mr(1810, branch="web-1810-own-approved", reviewers=me, approved_by=("alex1craig",)),
        mr(1811, branch="web-1811-both", author="alex1craig", reviewers=me, approved_by=("jonathan.walker2", "nish8")),
        mr(1812, branch="web-1812-two", author="alex1craig", reviewers=me, approved_by=("jonathan.walker2", "shivan2418")),
        mr(1813, branch="web-1813-offered", author="alex1craig", reviewers=me, sha="aa11bb22".ljust(40, "0")),
        mr(1814, branch="web-1814-new-head", author="alex1craig", reviewers=me, sha="cc33dd44".ljust(40, "0")),
    ]
    offered = (ITEMS_09.replace("!1571?", "!1813?").replace("web-2097-fix-cves-schedule", "web-1813-offered").replace("12cace69", "aa11bb22")
               .replace("!1579?", "!1814?").replace("web-2107-figaro-selector", "web-1814-new-head").replace("815b3867", "99887766"))
    yield "09", "order", build("09", "order", now=now, mrs=order, listed_by="reviewer", branch_mrs=True, state=vault(offered))


CASE_MAKERS.append(_09)


def pjob(ident, name, status="success", allow_failure=False):
    return {"id": ident, "name": name, "status": status, "allow_failure": allow_failure, "web_url": f"https://gitlab.com/j/{ident}"}


def pchild(ident, status):
    return {"id": ident, "status": status, "ref": "dev", "sha": str(ident).rjust(40, "0"), "web_url": f"https://gitlab.com/p/{ident}",
            "created_at": "2026-10-11T17:00:00Z"}


def _issue(ident, state, branch, created="2026-10-11T17:10:00.000Z"):
    return {"id": f"uuid-{ident}", "identifier": ident, "title": f"Fix hourly e2e failure ({ident})",
            "url": f"https://linear.app/herasight/issue/{ident}", "state": {"name": state, "type": state},
            "team": {"id": "team-web", "key": "WEB", "name": "Web Dev"}, "assignee": {"id": "u-nish", "displayName": "nish"},
            "priority": 2, "createdAt": created, "branchName": branch, "labels": [], "workspace": {"id": "ws1", "name": "Herasight"}}


def case_13(name, *, children, jobs, now, handled=None, tickets=None, linear_state=None, others=(), worktrees=(), quota=None):
    """One 13 case: the hourly children and their jobs, 13's own state (handled pipelines, tickets), what Linear says about
    each ticket (`linear_state`: ident -> state type, or "!why" when the old sweep's read of it fails), and the worktrees.
    The reads are the old sweep's, Pilot's pipeline source's, and Pilot's Linear listing (`assigned`: the signed-in user's tickets): the old state read is
    `orca linear issue <ID>`; Pilot's listing and its per-ticket details come with a workspace."""
    tickets, linear_state, handled = tickets or {}, linear_state or {}, handled or {}
    fixture = build("13", name, now=now, loop="dev-e2e", quota=quota or {"weekly": 20, "session": 10},
                    state={"dev-e2e/handled.json": handled, "dev-e2e/tickets.json": tickets})
    reads, exists = fixture["reads"], fixture["exists"]
    reads.append(glab(f"{PROJECT}/pipelines?source=parent_pipeline&ref=dev&order_by=id&sort=desc&per_page=30", children))
    for pid, listed in sorted(jobs.items()):
        reads.append(glab(f"{PROJECT}/pipelines/{pid}/jobs?per_page=100", listed))
    listing = [{"id": f"{REPO['id']}::{w['path']}", "repoId": REPO["id"], "path": w["path"], "branch": f"refs/heads/{w['branch']}",
                "isArchived": w["archived"], "linkedLinearIssue": w["linked"]} for w in worktrees]
    reads.append(read(["orca", "worktree", "list", "--json"], json={"ok": True, "result": {"worktrees": listing}}))
    reads.append(read(["orca", "terminal", "list", "--json"], json={"ok": True, "result": {"terminals": []}}))
    for w in worktrees:
        exists[w["path"]] = True
        git_reads(w, reads, exists)
    every = {ident: t["branch"] for ident, t in tickets.items()} | {ident: f"{ident.lower()}-other" for ident in others}
    state_of = lambda ident: (lambda v: "started" if v.startswith("!") else v)(linear_state.get(ident, "started"))  # noqa: E731
    for ident in tickets:
        why = linear_state.get(ident, "")
        if why.startswith("!"):
            reads.append(read(["orca", "linear", "issue", ident, "--json"], code=1, stdout="", stderr=why[1:]))
        else:
            reads.append(read(["orca", "linear", "issue", ident, "--json"], json={"ok": True, "result": {"issue": {"state": {"type": state_of(ident)}}}}))
    issues = [_issue(i, state_of(i), b) for i, b in sorted(every.items())]
    meta = {"filter": "assigned", "workspaceId": "all", "limit": 200, "returned": len(issues), "hasMore": False, "partial": False, "workspaceErrors": []}
    reads.append(read(["orca", "linear", "list", "--filter", "assigned", "--workspace", "all", "--limit", "200", "--json"],
                      json={"ok": True, "result": {"issues": [{k: v for k, v in i.items() if k not in ("branchName", "createdAt", "labels")} for i in issues],
                                                   "truncated": False, "meta": meta}}))
    reads.append(glab("user", {"username": "nish8"}))
    for issue in issues:
        if issue["state"]["type"] not in ("triage", "backlog", "unstarted", "started"):
            continue  # Pilot reads the details of the tickets it lists only
        ident, branch = issue["identifier"], issue["branchName"]
        reads.append(read(["orca", "linear", "issue", ident, "--workspace", "ws1", "--json"], json={"ok": True, "result": {"issue": issue}}))
        if any(w["linked"] == ident or w["branch"] == branch for w in worktrees):
            reads.append(glab(f"{PROJECT}/merge_requests?source_branch={urllib.parse.quote(branch, safe='')}&per_page=100", []))
        else:  # no worktree: whether the branch exists here (exit 1: it does not)
            reads.append(read(["git", "-C", REPO["path"], "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"], code=1, stdout="", stderr=""))
    return fixture


def _13():
    now = 1791738300000  # 10:05 Pacific, 2026-10-11
    red = lambda base: [pjob(base + 1, "e2e-checks-and-build", "failed"), pjob(base + 2, "test-apps-e2e: [tasks]", "failed"),  # noqa: E731
                        pjob(base + 3, "notify-slack")]
    green = lambda base: [pjob(base + 1, "e2e-checks-and-build"), pjob(base + 3, "notify-slack-recovery", "skipped")]  # noqa: E731
    no_op = lambda base: [pjob(base + 1, "e2e-skipped")]  # noqa: E731
    both = ["e2e-checks-and-build", "test-apps-e2e: [tasks]"]
    ticket = lambda jobs, branch, **extra: {"jobs": jobs, "pipeline": 3, "branch": branch, **extra}  # noqa: E731
    red_run = {"children": [pchild(9, "failed"), pchild(8, "success")], "jobs": {9: red(90), 8: green(80)}}
    # Its own pipeline id: the one known difference (quota-out comments) is exempted by this key only.
    red_run_19 = {"children": [pchild(19, "failed"), pchild(18, "success")], "jobs": {19: red(190), 18: green(180)}}
    green_run = {"children": [pchild(9, "success")], "jobs": {9: green(90)}}
    unstarted = {"WEB-2": ticket(["e2e-checks-and-build"], "web-2-fix")}
    out = {"weekly": 95, "session": 40}

    def make(name, **kw):
        return "13", name, case_13(name, now=now, **kw)

    yield make("no-suite-run", children=[pchild(9, "running"), pchild(8, "success")], jobs={8: no_op(80)})
    # All 30 children scanned ran nothing: no item, which is not the same as a run that passed.
    yield make("no-suite-run-in-30", children=[pchild(100 - n, "success") for n in range(30)],
               jobs={100 - n: no_op((100 - n) * 10) for n in range(30)})
    yield make("green-newest", **green_run)
    yield make("green-after-older-red", children=[pchild(9, "success"), pchild(8, "failed")], jobs={9: green(90), 8: red(80)})
    yield make("red-already-handled", **red_run, handled={"9": ["WEB-1"]})
    yield make("red-new-failures", **red_run)
    yield make("red-covered-by-open-ticket", **red_run, tickets={"WEB-1": ticket(both, "web-1-fix", path="/wt/web-1")})
    yield make("red-quota-out", **red_run, quota=out)
    yield make("red-covered-quota-out", **red_run_19, quota=out, tickets={"WEB-1": ticket(both, "web-1-fix", path="/wt/web-1")})
    yield make("allowed-failure-and-notifier-only", children=[pchild(9, "failed")],
               jobs={9: [pjob(91, "smoke", "failed", allow_failure=True), pjob(92, "notify-slack", "failed"), pjob(93, "e2e-checks-and-build")]})
    yield make("ticket-never-started", **green_run, tickets=unstarted)
    yield make("ticket-worktree-in-flight", **green_run, tickets=unstarted, worktrees=[worktree("web-2", "web-2-fix", dirty=1, linked="WEB-2")])
    yield make("ticket-worktree-clean", **green_run, tickets=unstarted, worktrees=[worktree("web-2", "web-2-fix", linked="WEB-2")])
    yield make("ticket-worktree-rebasing", **green_run, tickets=unstarted, worktrees=[worktree("web-2", "web-2-fix", operation="rebase-merge")])
    yield make("ticket-quota-out", **green_run, tickets=unstarted, quota=out)
    yield make("ticket-quota-out-and-dirty", **green_run, tickets=unstarted, quota=out, worktrees=[worktree("web-2", "web-2-fix", dirty=1, linked="WEB-2")])
    yield make("ticket-canceled", **green_run, tickets={"WEB-3": ticket(["e2e-checks-and-build"], "web-3-fix")}, linear_state={"WEB-3": "canceled"})
    yield make("ticket-state-unreadable", **green_run, tickets={"WEB-4": ticket(["e2e-checks-and-build"], "web-4-fix")},
               linear_state={"WEB-4": "!Linear timed out"})
    yield make("tickets-not-opened-by-13", **green_run, others=["WEB-50"])
    yield make("red-run-and-unstarted-ticket", **red_run, tickets={"WEB-2": unstarted["WEB-2"], "WEB-1": ticket(both, "web-1-fix", path="/wt/web-1")})


CASE_MAKERS.append(_13)


def case_m01(name, tickets, *, now, worktrees=(), started=None, tabs=None, local_branches=(), teammates=(), quota=None, partial=False):
    """One M01 case. <tickets>: (ident, state type, branch, priority, created) tuples, the tickets Linear lists as assigned to
    me; <worktrees> may link one (`linked=`); <started>: M01's started.json; <tabs>: worktree path -> terminal handle of an open
    kickoff tab; <local_branches>: branches that exist here; <teammates>: branches with a teammate's open MR. The reads are the
    old sweep's, Pilot's linear_ticket source's and the gates' (in-flight state, MR owner of an existing worktree's branch)."""
    tabs = tabs or {}
    fixture = build("M01", name, now=now, loop="linear-todo", quota=quota or {"weekly": 20, "session": 10},
                    state={"linear-todo/started.json": started or {}, "linear-todo/tabs.json": tabs})
    reads, exists = fixture["reads"], fixture["exists"]
    listing = [{"id": f"{REPO['id']}::{w['path']}", "repoId": REPO["id"], "path": w["path"], "branch": f"refs/heads/{w['branch']}",
                "isArchived": w["archived"], "linkedLinearIssue": w["linked"]} for w in worktrees]
    reads.append(read(["orca", "worktree", "list", "--json"], json={"ok": True, "result": {"worktrees": listing}}))
    reads.append(read(["orca", "terminal", "list", "--json"],
                      json={"ok": True, "result": {"terminals": [{"handle": h, "connected": True} for h in sorted(set(tabs.values()))]}}))
    for w in worktrees:
        exists[w["path"]] = True
        git_reads(w, reads, exists)
    reads.append(glab("user", {"username": "nish8"}))
    issues = []
    for ident, state, branch, priority, created in tickets:
        issue = _issue(ident, state, branch, created)
        issues.append({**issue, "priority": priority})
    meta = {"filter": "assigned", "workspaceId": "all", "limit": 200, "returned": len(issues), "hasMore": partial, "partial": False, "workspaceErrors": []}
    reads.append(read(["orca", "linear", "list", "--filter", "assigned", "--workspace", "all", "--limit", "200", "--json"],
                      json={"ok": True, "result": {"issues": [{k: v for k, v in i.items() if k not in ("branchName", "createdAt", "labels")} for i in issues],
                                                   "truncated": False, "meta": meta}}))
    for issue in issues:
        ident, branch = issue["identifier"], issue["branchName"]
        if issue["state"]["type"] == "unstarted":  # both sides read the details of the Todo tickets only
            reads.append(read(["orca", "linear", "issue", ident, "--workspace", "ws1", "--json"], json={"ok": True, "result": {"issue": issue}}))
        if not branch:
            continue
        local = branch in local_branches
        reads.append(read(["git", "-C", REPO["path"], "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"],
                          code=0 if local else 1, stdout="", stderr=""))
        for w in worktrees:
            if w["branch"] == branch or w["linked"] == ident:
                mrs = [mr(1588, branch=w["branch"], author="shivan2418")] if w["branch"] in teammates else []
                reads.append(glab(f"{PROJECT}/merge_requests?source_branch={urllib.parse.quote(w['branch'], safe='')}&per_page=100",
                                  [api_mr(m) for m in mrs]))
                reads.append(read(["glab", "mr", "list", "--source-branch", w["branch"], "--all", "--output", "json", "--repo", REPO["project"]],
                                  json=[{"iid": m["iid"], "state": m["state"], "author": {"username": m["author"]["username"]},
                                         "web_url": f"https://gitlab.com/{REPO['project']}/-/merge_requests/{m['iid']}"} for m in mrs]))
    return fixture


def _m01():
    now = 1791766800000  # 10:00 Pacific, 2026-10-11
    todo = lambda ident, priority=2, created="2026-10-01T00:00:00Z", **kw: (  # noqa: E731
        ident, kw.get("state", "unstarted"), kw.get("branch", f"{ident.lower()}-work"), priority, created)
    wt = lambda ident, **kw: worktree(ident.lower(), kw.pop("branch", f"{ident.lower()}-work"), linked=kw.pop("linked", ident), **kw)  # noqa: E731
    five = [todo("WEB-1", 0, "2026-01-01T00:00:00Z"), todo("WEB-2", 4, "2026-09-01T00:00:00Z"), todo("WEB-3", 1, "2026-10-01T00:00:00Z"),
            todo("WEB-4", 2, "2026-10-05T00:00:00Z"), todo("WEB-5", 2, "2026-09-01T00:00:00Z")]
    started = lambda *idents: {i: {"path": f"/wt/{i.lower()}", "handle": f"term_{i.lower()}", "startedAt": "2026-10-08T12:00:00+00:00"} for i in idents}  # noqa: E731

    def make(name, tickets, **kw):
        return "M01", name, case_m01(name, tickets, now=now, **kw)

    yield make("fresh-tickets-start-urgent-first-three-per-run", five)
    yield make("no-branch-name", [todo("WEB-1", branch=None)])
    yield make("local-branch-without-a-worktree", [todo("WEB-1")], local_branches=["web-1-work"])
    yield make("worktree-with-uncommitted-work", [todo("WEB-1")], worktrees=[wt("WEB-1", dirty=1)], local_branches=["web-1-work"])
    yield make("worktree-mid-rebase", [todo("WEB-1")], worktrees=[wt("WEB-1", operation="rebase-merge")], local_branches=["web-1-work"])
    yield make("teammates-branch", [todo("WEB-1")], worktrees=[wt("WEB-1")], local_branches=["web-1-work"], teammates=["web-1-work"])
    yield make("clean-worktree-gets-the-session", [todo("WEB-1")], worktrees=[wt("WEB-1")], local_branches=["web-1-work"])
    yield make("worktree-linked-under-another-name", [todo("WEB-1")], worktrees=[wt("WEB-1", branch="renamed-work", dirty=1)])
    yield make("kicked-off-tickets-never-start-again", [todo("WEB-1"), todo("WEB-2", created="2026-10-02T00:00:00Z")],
               worktrees=[wt("WEB-1"), wt("WEB-2")], local_branches=["web-1-work", "web-2-work"], started=started("WEB-1", "WEB-2"),
               tabs={"/wt/web-1": "term_web-1"})
    yield make("tickets-not-in-todo", [todo("WEB-1", state="started"), todo("WEB-2", state="backlog")])
    yield make("quota-out", five[:4], quota={"weekly": 95, "session": 30})
    yield make("incomplete-listing", [todo("WEB-1")], partial=True)


CASE_MAKERS.append(_m01)


STANDARDS = "Agent-Loop: standards"
NOW_03 = 1791739200000  # 10:20 Pacific, 2026-10-11


def own(n, at=1791735600):
    """One of my own commits on a branch (first-parent, not a merge)."""
    return {"sha": n.ljust(40, "0"), "body": f"feat: change {n}\n", "at": at}


def fix(n, at=1791736200):
    """One of the review cycle's own fixes: it carries the loop's trailer, so it isn't new work."""
    return {"sha": n.ljust(40, "0"), "body": f"refactor: standards round 1 by claude\n\n- src/a.ts: x -> y\n\n{STANDARDS}\nAgent-Round: 1\n",
            "at": at}


def wt03(n, *, seen="a" * 40, head=None, commits=None, rewritten=False, mrs=None, author="nish8", state="opened", approved_by=(),
         dirty=0, operation=None, mrs_error=None, approvals_error=None):
    """One worktree of a 03 case, on branch web-<n>-work: its review marker in seen.json (None: first sight), HEAD, its
    first-parent own commits since the marker (newest first; one own commit by default), and the branch's MRs (by default
    one MR, <author>'s, in <state>, approved by <approved_by>). <mrs_error>/<approvals_error>: GitLab can't list the
    branch's MRs / an open MR's approvals."""
    commits = [own(f"c{n}")] if commits is None else commits
    branch = f"web-{n}-work"
    if mrs is None:
        mrs = [{**mr(n, branch=branch, author=author, approved_by=approved_by), "state": state}]
    return {**worktree(f"web-{n}", branch, dirty=dirty, operation=operation), "seen": seen, "rewritten": rewritten,
            "head": head or (commits[0]["sha"] if commits else seen), "commits": commits, "mrs": mrs, "mrs_error": mrs_error,
            "approvals_error": approvals_error}


def codex_answer(session=10, weekly=20):
    """Codex's raw account/rateLimits/read answer, both windows resetting after the case's time."""
    now = NOW_03 // 1000
    return {"rateLimits": {"primary": {"usedPercent": session, "windowDurationMins": 300, "resetsAt": now + 3600},
                           "secondary": {"usedPercent": weekly, "windowDurationMins": 10080, "resetsAt": now + 3 * 86400},
                           "rateLimitReachedType": None},
            "ordinaryUsageAllowed": True}


def mr_reads_03(w, reads):
    """The branch's MRs as gate.branch_mrs lists them (glab mr list) and as Pilot's branch facts read them (the API), and
    each open MR's approvals, which both sides read the same way."""
    branch, mrs = w["branch"], w["mrs"]
    url = lambda m: f"https://gitlab.com/{REPO['project']}/-/merge_requests/{m['iid']}"  # noqa: E731
    cli = ["glab", "mr", "list", "--source-branch", branch, "--all", "--output", "json", "--repo", REPO["project"]]
    api = ["glab", "api", "--hostname", REPO["host"], f"{PROJECT}/merge_requests?source_branch={urllib.parse.quote(branch, safe='')}&per_page=100"]
    if w["mrs_error"]:
        reads.append(read(cli, code=1, stdout="", stderr=w["mrs_error"]))
        reads.append(read(api, code=1, stdout="", stderr=w["mrs_error"]))
        return
    reads.append(read(cli, json=[{"iid": m["iid"], "state": m["state"], "author": {"username": m["author"]["username"]},
                                  "web_url": url(m)} for m in mrs]))
    reads.append(read(api, json=[{**api_mr(m), "web_url": url(m)} for m in mrs]))
    for m in mrs:
        if m["state"] != "opened":
            continue
        approvals = ["glab", "api", "--hostname", REPO["host"], f"{PROJECT}/merge_requests/{m['iid']}/approvals"]
        if w["approvals_error"]:
            reads.append(read(approvals, code=1, stdout="", stderr=w["approvals_error"]))
        else:
            reads.append(read(approvals, json={"approved_by": [{"user": {"username": u}} for u in m["_approved_by"]]}))


def commit_reads_03(w, reads):
    """HEAD and whether the marker is still in its history, then the commits since it: the sweep's (gate.new_commits:
    rev-list, then each message) and Pilot's (one log in its own record format)."""
    path, head, seen = w["path"], w["head"], w["seen"]
    reads.append(read(["git", "-C", path, "rev-parse", "HEAD"], stdout=f"{head}\n", stderr=""))
    if not seen:
        return
    reads.append(read(["git", "-C", path, "merge-base", "--is-ancestor", seen, head], code=1 if w["rewritten"] else 0, stdout="", stderr=""))
    if w["rewritten"]:
        return
    commits = w["commits"]
    reads.append(read(["git", "-C", path, "rev-list", "--first-parent", "--no-merges", f"{seen}..HEAD"],
                      stdout="".join(f"{c['sha']}\n" for c in commits), stderr=""))
    for c in commits:
        reads.append(read(["git", "-C", path, "log", "-1", "--format=%B", c["sha"]], stdout=c["body"], stderr=""))
    reads.append(read(["git", "-C", path, "log", "--first-parent", "--no-merges", "--format=%H%x00%ct%x00%B%x1e", f"{seen}..HEAD"],
                      stdout="".join(f"{c['sha']}\x00{c['at']}\x00{c['body']}\x1e\n" for c in commits), stderr=""))


def case_03(name, worktrees, *, cycles=None, tabs=None, busy=(), claude=None, codex=None):
    """One 03 case: the worktrees (wt03), the sweep's cycles.json, its open tabs (worktree path -> (agent, handle)), the
    handles of those mid-turn (<busy>), and each agent's quota (Claude's {weekly, session}; Codex's raw answer). The
    reads are loop.py sweep's (gate.worktrees, evaluate, review_block, the tabs) and Pilot's (the worktree source's
    listing, branch facts and commits since the marker, and the worktree facts)."""
    tabs = tabs or {}
    state = {"standards/seen.json": {w["path"]: w["seen"] for w in worktrees if w["seen"]},
             "standards/cycles.json": cycles or {},
             "standards/tabs.json": {p: h for p, (agent, h) in tabs.items() if agent == "claude"},
             "standards/tabs-codex.json": {p: h for p, (agent, h) in tabs.items() if agent == "codex"},
             "quota/codex-rate-limits.json": codex or codex_answer()}
    fixture = build("03", name, now=NOW_03, quota=claude or {"weekly": 20, "session": 10}, state=state)
    reads, exists = fixture["reads"], fixture["exists"]
    listing = [{"id": f"{REPO['id']}::{w['path']}", "repoId": REPO["id"], "path": w["path"], "branch": f"refs/heads/{w['branch']}",
                "isArchived": False} for w in worktrees]
    reads.append(read(["orca", "worktree", "list", "--json"], json={"ok": True, "result": {"worktrees": listing}}))
    handles = sorted(h for _, h in tabs.values())
    reads.append(read(["orca", "terminal", "list", "--json"],
                      json={"ok": True, "result": {"terminals": [{"handle": h, "connected": True} for h in handles]}}))
    for h in handles:
        reads.append(read(["orca", "terminal", "wait", "--terminal", h, "--for", "tui-idle", "--timeout-ms", "1500", "--json"],
                          json={"ok": True, "result": {"wait": {"satisfied": h not in busy}}}))
    reads.append(glab("user", {"username": "nish8"}))
    for w in worktrees:
        exists[w["path"]] = True
        git_reads(w, reads, exists)
        mr_reads_03(w, reads)
        commit_reads_03(w, reads)
    return fixture


def _03():
    def make(name, worktrees, **kw):
        return "03", name, case_03(name, worktrees, **kw)

    unreadable = "glab: 502 Bad Gateway"
    # Every way the sweep leaves a worktree alone, one worktree each, and one due worktree.
    yield make("gates", [
        wt03(301, seen=None, head="d301".ljust(40, "0")),                              # first sight: baseline
        wt03(302, rewritten=True, head="d302".ljust(40, "0")),                         # rewritten history: baseline again
        wt03(303, commits=[fix("f303")]),                                              # only this loop's fixes: nothing new
        wt03(304, commits=[]),                                                         # HEAD is the reviewed head
        wt03(305, dirty=1),                                                            # uncommitted changes
        wt03(306, operation="MERGE_HEAD"),                                             # a merge in progress
        wt03(307, state="merged"),                                                     # !307 merged
        wt03(308, state="closed"),                                                     # !308 closed
        wt03(309, approved_by=("alex1craig",)),                                        # !309 approved by alex1craig
        wt03(310, approvals_error=unreadable),                                         # MR approval unknown
        wt03(311, author="shivan2418"),                                                # a teammate's branch: never listed
        wt03(312, mrs_error=unreadable),                                               # MR owner unknown: never listed
        wt03(313, state="merged", commits=[]),                                         # merged with nothing new: nothing new
        wt03(314, commits=[fix("f314"), own("c314")]),                                 # new work under a fix: due
    ])
    # The sweep's order: commits, then work in flight, then the MR rules; quota only when it starts a cycle.
    yield make("check-order", [
        wt03(321, dirty=1, approved_by=("alex1craig",)),                               # uncommitted, not approved
        wt03(322, dirty=1, state="merged"),                                            # uncommitted, not merged
        wt03(323, dirty=2, operation="rebase-merge"),                                  # the sweep says uncommitted; Pilot the rebase
        wt03(324, seen=None, head="d324".ljust(40, "0"), dirty=1),                     # first sight before the dirty tree
        wt03(325, author="shivan2418", dirty=1),                                       # a teammate's before anything
        wt03(326, approved_by=("alex1craig",)),                                        # approved before quota
        wt03(327),                                                                     # due, but Claude is out
    ], claude={"weekly": 95, "session": 30})
    yield make("two-per-tick", [wt03(331), wt03(332), wt03(333)])                      # the third is over the limit
    # A branch with no MR yet is mine and in scope on both sides (its cycle is reviewed; publish blocks until it's on origin).
    yield make("no-mr-yet", [wt03(371, mrs=[])])
    done = lambda path: {path: {"lead": "claude", "round": 2, "base": "9" * 40, "head": "a" * 40}}  # noqa: E731
    yield make("codex-leads-and-is-out", [wt03(341)], cycles=done("/wt/web-341"), codex=codex_answer(weekly=95))
    yield make("quota-out-other-agent", [wt03(342)], codex=codex_answer(weekly=95))   # Claude leads; only Codex is out
    # A cycle's agent mid-turn holds its worktree; an idle tab of the loop's doesn't.
    yield make("running-cycle", [wt03(351), wt03(352)], tabs={"/wt/web-351": ("claude", "term_351"), "/wt/web-352": ("codex", "term_352")},
               busy=["term_351"])
    # A cycle that stopped without a hand-off restarts; a parked hand-off carries on.
    yield make("abandoned-and-parked", [wt03(361), wt03(362)], cycles={
        "/wt/web-361": {"lead": "claude", "round": 2, "base": "a" * 40, "head": "9" * 40},
        "/wt/web-362": {"lead": "claude", "round": 2, "base": "a" * 40, "head": "c362".ljust(40, "0"),
                        "pending": {"agent": "codex", "text": f"$review-cycles review {'a' * 40} round 2 --push"}},
    })


CASE_MAKERS.append(_03)


def _canon(text):
    """JSON as data, with a fixed key order: formatting is free, but true vs 1 and 1 vs 1.0 are drift."""
    return json.dumps(json.loads(text), sort_keys=True)


def main(argv):
    check = argv[1:] == ["--check"]
    stale = []
    for job, name, fixture in cases():
        path = HERE / job / f"{name}.json"
        text = dump(fixture)
        if check:
            if not path.exists() or _canon(path.read_text()) != _canon(text):  # parsed: the commit hook reformats the JSON
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
