// pilotcli's playground as Pilot runs it (main/playground): one at a time, for one project.

// A repo Pilot lists that pilotcli knows as a project (`pilotcli self get-config -C <path>`).
export type PlaygroundProject = { path: string; name: string; project: string }

// Stopped carries why it stopped when it failed or never started; a Stop, from Pilot or the page, has no reason.
export type PlaygroundStatus =
  | { state: 'stopped'; repoPath: string | null; reason: string | null }
  | { state: 'starting'; repoPath: string }
  | { state: 'running'; repoPath: string; url: string }
