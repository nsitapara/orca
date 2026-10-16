// Where the code a chain step runs lives (pilot.sources.get): pilotcli's commands in the repository it was built
// from, and the skills folder. pilotcli is null when it doesn't say where it was built (before source_root).
export type SourceIndex = {
  pilotcli: { root: string; commands: Record<string, { file: string; line: number }> } | null
  skillsDir: string
}

// A step's code: a file in a worktree at a line (pilotcli's), or a file outside any worktree (a skill's SKILL.md).
export type StepSource =
  | { kind: 'worktree'; root: string; file: string; line: number }
  | { kind: 'file'; path: string }
