// Display-only rename (D23). "Orca" as a product word becomes "Pilot". Names of Orca's other products
// (Orca Mobile, Orca Cloud), the onorca.dev domain, orca:// links and the `orca` command stay as they
// are, because they refer to real Orca things Pilot still talks to (D25).
const KEEP_AFTER = /^\s+(Mobile|Cloud|MOBILE|CLOUD)\b/
const PRODUCT_WORD = /(?<![\w.:/`-])(Orca|ORCA)(?![\w])/g

export function pilotBrand(text: string): string {
  return text.replace(
    PRODUCT_WORD,
    (match: string, _word: string, offset: number, whole: string) => {
      const rest = whole.slice(offset + match.length)
      if (KEEP_AFTER.test(rest)) {
        return match
      }
      return match === 'ORCA' ? 'PILOT' : 'Pilot'
    }
  )
}
