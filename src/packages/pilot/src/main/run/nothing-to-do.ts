// A step starter found nothing for its step to do: the step stops and the run ends with nothing to do, as a shell
// step's `stop` exit code does (shared/run/step-plan.ts runEnd), instead of failing.
export class NothingToDoError extends Error {}
