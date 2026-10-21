// Next.js instrumentation — runs once on server startup (not on hot reload)
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Kode khusus Node (cron, MinIO SDK → node:fs) HARUS ada di file terpisah yang di-import di dalam kondisi
// POSITIF `=== 'nodejs'`. File ini dikompilasi juga untuk runtime Edge; pola `if (!== 'nodejs') return` tidak
// membuat webpack membuang import di bawahnya, sehingga `next build` gagal ("Reading from node:fs is not handled").
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node')
    await registerNode()
  }
}
