import type { HTTPRequest, Page } from "puppeteer"
import {
  UnsafeUrlError,
  assertPublicHostResolves,
  assertPublicHttpUrl,
} from "./url-guard"

export type NavigationSsrfGuardOptions = {
  /** Mirrors `assertPublicHttpUrl(..., { allowLoopback })`. */
  allowLoopback?: boolean
  /** Optional structured log hook for blocked navigations. */
  onBlock?: (info: { url: string; reason: string; resourceType: string }) => void
}

/**
 * Install a navigation-time SSRF guard on a Puppeteer page. This closes two
 * residual gaps that the pre-navigation guards in `url-guard.ts` cannot fully
 * cover from outside Chromium:
 *
 *  - DNS rebinding (TOCTOU): we re-run `assertPublicHostResolves` on every
 *    top-level document request, so a name that flipped to a private IP
 *    between pre-validation and the actual fetch is aborted before bytes
 *    leave the box. This does NOT perfectly defeat rebinding — Chromium has
 *    its own resolver cache and could theoretically resolve to a different IP
 *    than our `dns.lookup` — but on systems sharing the OS resolver cache the
 *    window collapses to the resolver's TTL, which is the tightest we can do
 *    without `--host-resolver-rules` IP pinning.
 *  - Cross-origin redirects: Chromium emits a new `request` event for each
 *    3xx hop, so a public origin that 302s to `http://127.0.0.1/` is caught.
 *
 * Scope / perf:
 *  - Only `resourceType() === "document"` requests get the full sync + DNS
 *    check. Subresources (image/script/xhr/stylesheet/…) are passed through
 *    to avoid paying DNS latency on dozens of assets per page. Subresources
 *    cannot introduce a new top-level navigation target.
 *  - Non-http(s) schemes (`about:blank`, `data:`, `blob:`, …) are passed
 *    through — Chromium uses `about:blank` internally during page setup and
 *    blocking it would break captures.
 *
 * MUST be installed BEFORE the first `page.goto`, otherwise the initial
 * document is not intercepted.
 */
export async function installNavigationSsrfGuard(
  page: Page,
  opts: NavigationSsrfGuardOptions = {}
): Promise<void> {
  await page.setRequestInterception(true)
  page.on("request", async (request: HTTPRequest) => {
    try {
      const url = request.url()
      const resourceType = request.resourceType()

      if (resourceType !== "document" || !/^https?:\/\//i.test(url)) {
        await request.continue()
        return
      }

      assertPublicHttpUrl(url, { allowLoopback: opts.allowLoopback })
      const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "")
      await assertPublicHostResolves(hostname, {
        allowLoopback: opts.allowLoopback,
      })

      await request.continue()
    } catch (err) {
      const reason =
        err instanceof UnsafeUrlError
          ? err.message
          : err instanceof Error
            ? `guard error: ${err.message}`
            : `guard error: ${String(err)}`
      try {
        // Surfaces to the caller as net::ERR_BLOCKED_BY_CLIENT, which is
        // already handled by the existing `page.goto(...).catch` blocks.
        await request.abort("blockedbyclient")
      } catch {
        /* request already resolved (continue/abort race) — swallow */
      }
      opts.onBlock?.({
        url: request.url(),
        reason,
        resourceType: request.resourceType(),
      })
    }
  })
}
