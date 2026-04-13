const isDev = process.env.NODE_ENV !== "production"

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
      void new URL(v)
    } catch {
      throw new Error(`[next.config] ${key} must be a valid absolute URL (got: ${JSON.stringify(v)})`)
    }
  }
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"

/** Origins allowed for fetch() + <video> to clip/generated media (CSP connect-src + media-src). */
function apiOriginsForCsp() {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").trim()
  let base = raw.replace(/\/$/, "")
  if (base.endsWith("/api")) base = base.slice(0, -4)
  try {
    const u = new URL(base)
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

  async rewrites() {
    const upstream = apiBaseUrl.replace(/\/$/, "")
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
