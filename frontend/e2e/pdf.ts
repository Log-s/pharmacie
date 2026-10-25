import { inflateSync } from 'node:zlib'

export type Heading = { level: number; title: string }

/** `<feff…>` hex strings are UTF-16BE, `(…)` literals are Latin-1 with backslash escapes. */
function pdfString(raw: string): string {
  if (raw.startsWith('<')) return Buffer.from(raw.slice(1, -1), 'hex').subarray(2).swap16().toString('utf16le')
  return raw.slice(1, -1).replace(/\\(.)/g, '$1')
}

/**
 * The bookmark tree of a WeasyPrint PDF (one entry per h1..h6, depth = heading level), in reading order.
 * WeasyPrint packs its dictionaries in compressed object streams, so those are inflated first; no PDF library needed.
 */
export function pdfHeadings(pdf: Buffer): Heading[] {
  const text = pdf.toString('latin1')
  const objects = new Map<number, string>()
  for (const stream of text.matchAll(/<<([^>]*\/Type \/ObjStm[^>]*)>>\s*stream\r?\n/g)) {
    const first = Number(/\/First (\d+)/.exec(stream[1])?.[1])
    const start = stream.index + stream[0].length
    const body = inflateSync(pdf.subarray(start, text.indexOf('endstream', start))).toString('latin1')
    const header = body.slice(0, first).trim().split(/\s+/).map(Number)
    for (let i = 0; i < header.length; i += 2) {
      const end = i + 2 < header.length ? first + header[i + 3] : body.length
      objects.set(header[i], body.slice(first + header[i + 1], end))
    }
  }
  const ref = (object: string, key: string) => Number(new RegExp(`/${key} (\\d+) 0 R`).exec(object)?.[1])
  const root = [...objects.values()].find((o) => !o.includes('/Title') && /\/First \d+ 0 R/.test(o))
  const walk = (id: number, level: number): Heading[] => {
    if (!id) return []
    const item = objects.get(id) ?? ''
    const title = pdfString(/\/Title\s*(\([^)]*\)|<[0-9a-f]+>)/i.exec(item)?.[1] ?? '()')
    return [{ level, title }, ...walk(ref(item, 'First'), level + 1), ...walk(ref(item, 'Next'), level)]
  }
  return root ? walk(ref(root, 'First'), 1) : []
}
