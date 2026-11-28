/** Lightweight web fetch / search when Settings → webSearch is on. */

export type FetchResult = { ok: boolean; url: string; title?: string; text?: string; error?: string }

const BLOCKED_HOST =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])$/i
const BLOCKED_IP =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|100\.64\.|metadata\.google|metadata\.azure)/i

/** SSRF guard — block link-local, loopback, private, cloud metadata. */
export function isBlockedUrl(url: string): boolean {
  if (/^file:/i.test(url)) return true
  if (!/^https?:\/\//i.test(url)) return true
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (BLOCKED_HOST.test(host)) return true
    if (BLOCKED_IP.test(host)) return true
    // decimal IP tricks
    if (/^\d+$/.test(host)) return true
    return false
  } catch {
    return true
  }
}

export async function fetchUrl(url: string, maxChars = 6000): Promise<FetchResult> {
  try {
    if (isBlockedUrl(url)) {
      return { ok: false, url, error: 'Blocked URL (SSRF protection: no private/link-local/metadata)' }
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TriCassAI/0.1 (local research)' },
      signal: AbortSignal.timeout(12_000),
      redirect: 'manual'
    })
    // Do not follow redirects to private IPs blindly
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || ''
      if (loc && isBlockedUrl(loc)) {
        return { ok: false, url, error: 'Blocked redirect target (SSRF)' }
      }
      if (loc && /^https?:\/\//i.test(loc)) return fetchUrl(loc, maxChars)
    }
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
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TriCassAI/0.1' },
      signal: AbortSignal.timeout(12_000)
    })
    const html = await res.text()
    const links = [...html.matchAll(/uddg=([^&"]+)/g)]
      .map((m) => decodeURIComponent(m[1]))
      .filter((u) => /^https?:\/\//i.test(u) && !isBlockedUrl(u))
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
