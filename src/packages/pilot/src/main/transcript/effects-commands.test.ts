import { describe, expect, it } from 'vitest'
import { commandEffects } from './effects-commands'

describe('commandEffects', () => {
  it.each([
    ['git push origin web-1', [{ kind: 'pushed', target: 'web-1' }]],
    ['git -C /wt push -u origin HEAD', [{ kind: 'pushed', target: null }]],
    ['git push --dry-run origin web-1', []],
    ['git push origin HEAD:refs/heads/web-2', [{ kind: 'pushed', target: 'web-2' }]],
    ['git push origin web-1 2>&1 | tail -3', [{ kind: 'pushed', target: 'web-1' }]],
    [
      'rtk git add . && rtk git commit -m "fix: git push docs" && rtk git push',
      [{ kind: 'pushed', target: null }]
    ],
    ["echo 'git push origin x'", []],
    [
      "cat <<'EOF' | orca linear comment add WEB-1 --body-file -\nplease git push origin x\nEOF",
      [{ kind: 'ticket_commented', target: 'WEB-1' }]
    ],
    ['pilotcli git push-branch web-3', [{ kind: 'pushed', target: 'web-3' }]],
    ['pilotcli git push-branch', [{ kind: 'pushed', target: null }]],
    ['pilotcli gitlab reply-thread !12 abc', [{ kind: 'mr_commented', target: '!12' }]],
    ['glab mr create --fill --yes', [{ kind: 'mr_opened', target: null }]],
    ['glab mr update 1631 --ready', [{ kind: 'mr_updated', target: '!1631' }]],
    ['glab mr note !12 -m hi', [{ kind: 'mr_commented', target: '!12' }]],
    [
      'glab api -X POST "projects/g%2Fp/jobs/77/retry"',
      [{ kind: 'gitlab_write', target: 'projects/g%2Fp/jobs/77/retry' }]
    ],
    [
      'glab api --method=PUT projects/1/merge_requests/2',
      [{ kind: 'gitlab_write', target: 'projects/1/merge_requests/2' }]
    ],
    [
      'glab api projects/1/merge_requests/2/notes -f body=hi',
      [{ kind: 'gitlab_write', target: 'projects/1/merge_requests/2/notes' }]
    ],
    ['glab api "projects/1/jobs/5/trace"', []],
    ['orca linear create --title x --json', [{ kind: 'ticket_created', target: null }]],
    ['orca linear comment add --help', []],
    [
      '/Applications/Pilot.app/Contents/Resources/bin/orca linear issue update WEB-9 --state Done',
      [{ kind: 'ticket_updated', target: 'WEB-9' }]
    ],
    ['orca linear issue WEB-9 --json', []],
    [
      'glab api -X POST \\\n  projects/1/jobs/5/retry',
      [{ kind: 'gitlab_write', target: 'projects/1/jobs/5/retry' }]
    ],
    ['git push -u \\\n  origin web-1', [{ kind: 'pushed', target: 'web-1' }]],
    ['glab mr update --title "Fix login bug" --ready', [{ kind: 'mr_updated', target: null }]],
    ['glab mr note -m 5 12', [{ kind: 'mr_commented', target: '!12' }]],
    ['pilotcli git push-branch --format text web-3', [{ kind: 'pushed', target: 'web-3' }]],
    ['git push -o ci.skip origin web-1', [{ kind: 'pushed', target: 'web-1' }]],
    ['git push origin "$BRANCH"', [{ kind: 'pushed', target: null }]],
    ['git push origin $(git branch --show-current)', [{ kind: 'pushed', target: null }]],
    ['git push origin web-1 > /tmp/push.log', [{ kind: 'pushed', target: 'web-1' }]],
    ["glab api graphql -f query='{ currentUser { id } }'", []],
    ["glab api graphql -f query='mutation { x }'", [{ kind: 'gitlab_write', target: 'graphql' }]],
    ['cat <<< "foo"\ngit push origin web-1', [{ kind: 'pushed', target: 'web-1' }]],
    ['echo "a <<EOF"\ngit push origin web-1', [{ kind: 'pushed', target: 'web-1' }]],
    ['FOO=1 env BAR=2 git push origin web-5', [{ kind: 'pushed', target: 'web-5' }]]
  ])('%s', (command, effects) => {
    expect(commandEffects(command)).toEqual(effects)
  })
})
