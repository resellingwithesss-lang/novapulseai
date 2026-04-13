import fs from "fs"
import path from "path"
import dotenv from "dotenv"

/**
 * Load `.env` from the server package root (next to `package.json`), not `process.cwd()`.
 * Optionally merges `process.cwd()/.env` without overriding keys already set (for monorepo root env).
 */
export function loadServerEnv(): { sources: string[] } {
  const serverRoot = path.resolve(__dirname, "..", "..")
  const serverEnvPath = path.join(serverRoot, ".env")
  const cwdEnvPath = path.resolve(process.cwd(), ".env")
  const sources: string[] = []

  if (fs.existsSync(serverEnvPath)) {
    dotenv.config({ path: serverEnvPath })
    sources.push(serverEnvPath)
  }
  if (
    fs.existsSync(cwdEnvPath) &&
    path.resolve(cwdEnvPath) !== path.resolve(serverEnvPath)
  ) {
    dotenv.config({ path: cwdEnvPath })
    sources.push(`${cwdEnvPath} (merge)`)
  }
  if (sources.length === 0) {
    dotenv.config()
    sources.push(`dotenv default cwd=${process.cwd()}`)
  }

  return { sources }
}
