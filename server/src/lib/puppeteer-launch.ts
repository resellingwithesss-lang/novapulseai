import puppeteer from "puppeteer"

type LaunchArg = NonNullable<Parameters<typeof puppeteer.launch>[0]>

/**
 * Shared Chromium launch settings for Docker / hardened hosts.
 * Set `PUPPETEER_EXECUTABLE_PATH` (e.g. `/usr/bin/chromium`) when the image does not use Puppeteer's bundled browser.
 * Optional: `PUPPETEER_EXTRA_CHROMIUM_ARGS` — space-separated extra flags.
 */
export function puppeteerLaunchOptions(extra?: Partial<LaunchArg>): LaunchArg {
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  const extraArgs =
    process.env.PUPPETEER_EXTRA_CHROMIUM_ARGS?.split(/\s+/).filter(Boolean) ?? []
  return {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      ...extraArgs,
    ],
    ...(execPath ? { executablePath: execPath } : {}),
    ...extra,
  }
}
