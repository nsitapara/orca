import { glabExecFileAsync } from '../../../../../main/git/command-runner/glab-exec-file'
import { getGlabKnownHosts } from '../../../../../main/gitlab/gitlab-known-host-probe'
import {
  getProjectRef,
  glabHostnameArgs,
  glabRepoExecOptions
} from '../../../../../main/gitlab/gitlab-project-ref-resolution'
import { encodedProject } from '../../../../../main/gitlab/project-path-encoding'

export type GlabApi = { projectPath: string; get<T>(path: string): Promise<T> }

// One glab-backed REST client per repo, reusing Orca's host resolution and its concurrency gate.
export async function glabApiForRepo(repoPath: string): Promise<GlabApi> {
  const ref = await getProjectRef(repoPath, await getGlabKnownHosts())
  if (!ref) {
    throw new Error(
      `No GitLab project found for ${repoPath}: its origin remote isn't a GitLab project glab knows`
    )
  }
  const project = encodedProject(ref.path)
  return {
    projectPath: ref.path,
    async get<T>(path: string): Promise<T> {
      const args = ['api', ...glabHostnameArgs(ref, undefined), `projects/${project}/${path}`]
      const { stdout } = await glabExecFileAsync(args, glabRepoExecOptions(repoPath, undefined))
      return JSON.parse(stdout) as T
    }
  }
}
