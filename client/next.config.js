const isDev = process.env.NODE_ENV !== "production"

/**
 * Express base URL for rewrites/CSP: trim trailing slashes and trailing `/api`
 * so destination is always `${base}/api/:path*` (never `/api/api/...`).
 */
function normalizeUpstreamBaseUrl(raw) {
  let u = String(raw ?? "").trim()
  if (!u) return "http://localhost:5000"
  u = u.replace(/\/$/, "")
  if (u.endsWith("/api")) u = u.slice(0, -4).replace(/\/$/, "")
  return u
}

/** Strip trailing slash and optional `/api` so origin matches Express base, not ".../api". */
function canonicalApiUpstreamForCompare(raw) {
  const base = normalizeUpstreamBaseUrl(raw)
  const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`
  return new URL(withScheme)
}

function appOriginFromEnv(raw) {
  const t = String(raw || "").trim()
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`
  return new URL(withScheme).origin
}

if (!isDev) {
  const required = ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_APP_URL"]
  for (const key of required) {
    const v = process.env[key]?.trim()
    if (!v) {
      throw new Error(
        `[next.config] Production build requires ${key}. Set it before running next build (e.g. in CI or the host build environment).`
      )
    }
    try {
      void new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    } catch {
      throw new Error(`[next.config] ${key} must be a valid absolute URL (got: ${JSON.stringify(v)})`)
    }
  }

  const appOrigin = appOriginFromEnv(process.env.NEXT_PUBLIC_APP_URL)
  const apiParsed = canonicalApiUpstreamForCompare(process.env.NEXT_PUBLIC_API_URL)
  const apiOrigin = apiParsed.origin

  if (appOrigin === apiOrigin) {
    throw new Error(
      `[next.config] Deployment topology error: NEXT_PUBLIC_APP_URL origin (${appOrigin}) equals NEXT_PUBLIC_API_URL origin (${apiOrigin}). ` +
        `Browser calls same-origin /api/*; Next rewrites those to NEXT_PUBLIC_API_URL. If both are the same origin, ` +
        `rewrites target this Next app instead of Express — billing will never hit the API server. ` +
        `Set NEXT_PUBLIC_API_URL to the Express host (e.g. https://api.yourdomain.com). See docs/deployment-topology.md.`
    )
  }

  const apiHost = apiParsed.hostname
  if (apiHost !== "localhost" && apiHost !== "127.0.0.1" && apiParsed.protocol !== "https:") {
    throw new Error(
      `[next.config] Production NEXT_PUBLIC_API_URL must use https:// unless hostname is localhost (got ${apiParsed.protocol}//${apiHost}).`
    )
  }
}

const apiBaseUrl = normalizeUpstreamBaseUrl(process.env.NEXT_PUBLIC_API_URL)

/** Origins allowed for fetch() + <video> to clip/generated media (CSP connect-src + media-src). */
function apiOriginsForCsp() {
  const base = apiBaseUrl
  try {
    const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`
    const u = new URL(withScheme)
    const parts = [u.origin]
    if (u.protocol === "http:" || u.protocol === "https:") {
      const portPart = u.port ? `:${u.port}` : ""
      if (u.hostname === "localhost") {
        parts.push(`${u.protocol}//127.0.0.1${portPart}`)
      } else if (u.hostname === "127.0.0.1") {
        parts.push(`${u.protocol}//localhost${portPart}`)
      }
    }
    return [...new Set(parts)].join(" ")
  } catch {
    return "http://localhost:5000 http://127.0.0.1:5000"
  }
}

const cspApiOrigins = apiOriginsForCsp()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "unsafe-none",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value: isDev
              ? `
                default-src 'self';
                script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com;
                connect-src 'self' ${cspApiOrigins} https://accounts.google.com;
                media-src 'self' ${cspApiOrigins} blob: data:;
                img-src 'self' data: https:;
                style-src 'self' 'unsafe-inline';
                frame-src https://accounts.google.com;
              `.replace(/\n/g, "")
              : `
                default-src 'self';
                script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://www.gstatic.com;
                connect-src 'self' ${cspApiOrigins} https://accounts.google.com;
                media-src 'self' ${cspApiOrigins} blob: data: https:;
                img-src 'self' data: https:;
                style-src 'self';
                frame-src https://accounts.google.com;
              `.replace(/\n/g, ""),
          },
        ],
      },
    ]
  },

  /**
   * Proxy browser same-origin `/api/*` to Express. Order: first match wins — keep `/api` first.
   * Runs for all environments (not dev-only). Production also enforces env above.
   */
  async rewrites() {
    const envRaw = process.env.NEXT_PUBLIC_API_URL
    if (!envRaw?.trim()) {
      // eslint-disable-next-line no-console
      console.warn(
        "[next.config] NEXT_PUBLIC_API_URL is missing. Rewrites send /api/* → http://localhost:5000/api/*. " +
          "Set NEXT_PUBLIC_API_URL to your Express base URL (e.g. https://api.example.com) in .env.local or the host env."
      )
    }

    const upstream = normalizeUpstreamBaseUrl(envRaw)

    return [
      {
        source: "/api/:path*",
        destination: `${upstream}/api/:path*`,
      },
      {
        source: "/clips/:path*",
        destination: `${upstream}/clips/:path*`,
      },
      {
        source: "/generated/:path*",
        destination: `${upstream}/generated/:path*`,
      },
    ]
  },

  async redirects() {
    return [
      {
        source: "/tools",
        destination: "/dashboard/tools",
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
