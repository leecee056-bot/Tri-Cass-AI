/** Lightweight web fetch / search when Settings → webSearch is on. */

export type FetchResult = { ok: boolean; url: string; title?: string; text?: string; error?: string }

const DENY = [/localhost/i, /127\.0\.0\.1/, /0\.0\.0\.0/, /file:/i]

export async function fetchUrl(url: string, maxChars = 6000): Promise<FetchResult> {
  try {
    if (!/^https?:\/\//i.test(url) || DENY.some((r) => r.test(url))) {
      return { ok: false, url, error: 'Only http(s) public URLs allowed' }
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TriCassAI/0.1 (local research)' },
      signal: AbortSignal.timeout(12_000)
    })
    if (!res.ok) return { ok: false, url, error: `HTTP ${res.status}` }
    const ct = res.headers.get('content-type') || ''
    if (!/text|html|json|xml|markdown/i.test(ct)) {
      return { ok: false, url, error: `Unsupported content-type ${ct}` }
    }
    let body = await res.text()
    body = body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const title = body.slice(0, 80)
    return { ok: true, url, title, text: body.slice(0, maxChars) }
  } catch (err) {
    return { ok: false, url, error: err instanceof Error ? err.message : String(err) }
  }
}

/** DuckDuckGo HTML lite search — no API key. */
export async function webSearch(query: string, limit = 3): Promise<FetchResult[]> {
  const q = encodeURIComponent(query.trim())
  if (!q) return []
  const url = `https://html.duckduckgo.com/html/?q=${q}`
  const page = await fetchUrl(url, 20_000)
  if (!page.ok || !page.text) return [{ ok: false, url, error: page.error || 'search failed' }]
  // DDG lite returns plain-ish text after strip; also try to pull result links from raw
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TriCassAI/0.1' },
      signal: AbortSignal.timeout(12_000)
    })
    const html = await res.text()
    const links = [...html.matchAll(/uddg=([^&"]+)/g)]
      .map((m) => decodeURIComponent(m[1]))
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, limit)
    const out: FetchResult[] = []
    for (const link of links) {
      out.push(await fetchUrl(link, 2500))
    }
    if (!out.length) {
      out.push({ ok: true, url, title: 'Search summary', text: page.text.slice(0, 1500) })
    }
    return out
  } catch (err) {
    return [{ ok: false, url, error: err instanceof Error ? err.message : String(err) }]
  }
}
