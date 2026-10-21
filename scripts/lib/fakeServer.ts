import { createServer, type IncomingHttpHeaders } from 'node:http'

// Server HTTP palsu untuk skrip uji (Resend, GOWA, Google). Memakai node:http — bukan Bun.serve — supaya `tsc` project
// ini (yang tidak memuat tipe Bun) tetap bersih.

export type FakeRequest = { method: string; path: string; headers: Headers; body: Record<string, unknown>; /** waktu (ms epoch) permintaan DITERIMA server */ at: number }
export type FakeResponse = { status: number; body?: unknown; headers?: Record<string, string> }
export type FakeServer = { port: number; stop: () => Promise<void> }

function toHeaders(h: IncomingHttpHeaders): Headers {
  const out = new Headers()
  for (const [k, v] of Object.entries(h)) if (typeof v === 'string') out.set(k, v)
  return out
}

export async function startFakeServer(handler: (req: FakeRequest) => FakeResponse | Promise<FakeResponse>): Promise<FakeServer> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', async () => {
      const at = Date.now()
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown> } catch { /* bukan JSON */ }
      const out = await handler({ method: req.method ?? 'GET', path: new URL(req.url ?? '/', 'http://x').pathname, headers: toHeaders(req.headers), body, at })
      res.writeHead(out.status, { 'content-type': 'application/json', ...out.headers })
      res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {}))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    port,
    stop: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()) }),
  }
}
