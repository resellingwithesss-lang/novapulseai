"use client"

/**
 * Catches errors in the root layout. Must define its own <html> and <body>.
 * @see https://nextjs.org/docs/app/building-your-application/routing/error-handling
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b0f19] text-white antialiased">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Application error</h1>
          <p className="mt-3 text-sm text-white/60">
            A critical error occurred while loading the app shell. Try refreshing the page.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-8 rounded-full bg-gradient-to-r from-purple-500 to-pink-600 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
