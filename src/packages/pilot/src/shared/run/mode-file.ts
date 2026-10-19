import { parse } from 'yaml'
import { OUTPUT_KEY } from './outputs'

// A skill mode (skills/<skill>/modes/<mode>.md): optional YAML frontmatter, then the text a wrapped
// prompt carries. `outputs` names what the step reports with `pilot run output`; null = undeclared.
export type ModeFile = {
  outputs: string[] | null
  inputs: string[] | null
  description: string | null
  body: string
}
export type ModeParse = { ok: true; mode: ModeFile } | { ok: false; error: string }

export const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/
const KEYS = ['outputs', 'inputs', 'description']

function names(
  value: unknown,
  key: string,
  file: string
): { ok: true; list: string[] | null } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, list: null }
  }
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    return { ok: false, error: `${file}: ${key} must be a list of names` }
  }
  const bad = value.find((v) => !OUTPUT_KEY.test(v))
  if (bad !== undefined) {
    return {
      ok: false,
      error: `${file}: ${key}: "${bad}" isn't an output name: letters, digits and _, not starting with a digit`
    }
  }
  return { ok: true, list: value }
}

function readMeta(
  text: string,
  file: string
): { ok: true; meta: Record<string, unknown> } | { ok: false; error: string } {
  let meta: unknown
  try {
    meta = parse(text)
  } catch (error) {
    return {
      ok: false,
      error: `${file}: frontmatter isn't valid YAML: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (meta === null || meta === undefined) {
    return { ok: true, meta: {} }
  }
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return { ok: false, error: `${file}: frontmatter must be a mapping` }
  }
  const unknown = Object.keys(meta).find((k) => !KEYS.includes(k))
  if (unknown !== undefined) {
    return {
      ok: false,
      error: `${file}: unknown frontmatter key "${unknown}" (allowed: ${KEYS.join(', ')})`
    }
  }
  return { ok: true, meta: meta as Record<string, unknown> }
}

export function parseModeFile(text: string, file: string): ModeParse {
  const front = FRONTMATTER.exec(text)
  if (!front) {
    return { ok: true, mode: { outputs: null, inputs: null, description: null, body: text.trim() } }
  }
  const meta = readMeta(front[1], file)
  if (!meta.ok) {
    return meta
  }
  const outputs = names(meta.meta.outputs, 'outputs', file)
  if (!outputs.ok) {
    return outputs
  }
  const inputs = names(meta.meta.inputs, 'inputs', file)
  if (!inputs.ok) {
    return inputs
  }
  const description = typeof meta.meta.description === 'string' ? meta.meta.description : null
  return {
    ok: true,
    mode: {
      outputs: outputs.list,
      inputs: inputs.list,
      description,
      body: text.slice(front[0].length).trim()
    }
  }
}
