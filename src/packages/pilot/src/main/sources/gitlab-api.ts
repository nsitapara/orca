import { glabExecFileAsync } from '../../../../../main/git/command-runner/glab-exec-file'
import { getGlabKnownHosts } from '../../../../../main/gitlab/gitlab-known-host-probe'
import {
  getProjectRef,
  glabHostnameArgs,
  glabRepoExecOptions
} from '../../../../../main/gitlab/gitlab-project-ref-resolution'
import { encodedProject } from '../../../../../main/gitlab/project-path-encoding'

export type GlabApi = {
  projectPath: string
  get<T>(path: string): Promise<T>
  // Paths outside the project (`user`). Optional so test fakes that never need it stay small.
  getRoot?<T>(path: string): Promise<T>
}

// One glab-backed REST client per repo, reusing Orca's host resolution and glab runner.
export async function glabApiForRepo(repoPath: string): Promise<GlabApi> {
  const ref = await getProjectRef(repoPath, await getGlabKnownHosts())
  if (!ref) {
    throw new Error(
      `No GitLab project found for ${repoPath}: its origin remote isn't a GitLab project glab knows`
    )
  }
  const project = encodedProject(ref.path)
  const found = ref
  const call = async <T>(apiPath: string): Promise<T> => {
    const args = ['api', ...glabHostnameArgs(found, undefined), apiPath]
    const { stdout } = await glabExecFileAsync(args, glabRepoExecOptions(repoPath, undefined))
    return JSON.parse(stdout) as T
  }
  return {
    projectPath: found.path,
    get: <T>(path: string) => call<T>(`projects/${project}/${path}`),
    getRoot: <T>(path: string) => call<T>(path)
  }
}
