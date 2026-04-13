import { ApiError } from "@/lib/api"

export function formatAuthError(
  err: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (err instanceof ApiError) {
    if (err.code === "CIRCUIT_OPEN") {
      return "The app paused requests after several API failures. Wait about 15 seconds, make sure the backend is running (port 5000), then try again."
    }
    if (err.code === "SESSION_NOT_ESTABLISHED") {
      return (
        err.message ||
        "Session cookie was not saved. Use one consistent host (localhost or 127.0.0.1), check the API on port 5000, and try again."
      )
    }
    if (
      err.code === "GOOGLE_PROFILE_UNAVAILABLE" ||
      err.code === "GOOGLE_ID_TOKEN_INVALID" ||
      err.code === "GOOGLE_EMAIL_UNVERIFIED" ||
      err.code === "GOOGLE_PAYLOAD_INCOMPLETE"
    ) {
      return (
        err.message ||
        "Google sign-in could not finish. Check OAuth client IDs and Authorized JavaScript origins in Google Cloud Console."
      )
    }
    if (err.code === "GOOGLE_ACCOUNT_CONFLICT") {
      return (
        err.message ||
        "This email is already registered with a different sign-in method."
      )
    }
    if (err.status === 403 && err.code === "ACCOUNT_DISABLED") {
      return (
        err.message ||
        "This account has been disabled. Contact support if you believe this is a mistake."
      )
    }
    if (err.status === 401) {
      const raw = (err.message || "").trim()
      const low = raw.toLowerCase()
      // Password login uses 401 + "Invalid credentials". Google OAuth uses 401 + "Google authentication failed".
      // Do not collapse OAuth / token failures into the password copy.
      if (low.includes("google")) {
        return (
          raw ||
          "Google sign-in failed. Check API Google OAuth config (GOOGLE_CLIENT_ID) and try again."
        )
      }
      if (low.includes("invalid credentials")) {
        return "Invalid email or password."
      }
      return raw || "Invalid email or password."
    }
    if (err.status === 409) {
      if (err.code === "GOOGLE_ACCOUNT_CONFLICT") {
        return (
          err.message ||
          "An account already exists for this email. Use email and password or contact support."
        )
      }
      return "An account with this email already exists. Try signing in."
    }
    if (err.status === 500) {
      if (err.code === "GOOGLE_USER_UNAVAILABLE") {
        return err.message || "Could not load your Google-linked account. Try again or use email and password."
      }
      if (err.code === "GOOGLE_SIGNIN_SERVER_ERROR") {
        return (
          err.message ||
          "Google sign-in hit a server error. Try again in a moment or use email and password."
        )
      }
    }
    if (err.status === 400) {
      return err.message || "Please check your details and try again."
    }
    if (err.status === 408 || err.code === "TIMEOUT") {
      return "Request timed out. Check your connection and try again."
    }
    if (err.status === 503) {
      if (err.code === "DATABASE_SCHEMA_MIGRATION_REQUIRED") {
        return (
          err.message ||
          "The API database needs a migration. Run prisma migrate deploy on the server, restart the API, then try again."
        )
      }
      if (err.code === "GOOGLE_NOT_CONFIGURED") {
        return (
          err.message ||
          "Google sign-in isn’t configured on the API server. Set GOOGLE_CLIENT_ID (same Web client ID as NEXT_PUBLIC_GOOGLE_CLIENT_ID), restart the backend, or use email and password."
        )
      }
      const msg = (err.message || "").toLowerCase()
      if (msg.includes("google")) {
        return "Google sign-in isn’t configured on the API server. Set GOOGLE_CLIENT_ID in the server’s .env (same Web client ID as NEXT_PUBLIC_GOOGLE_CLIENT_ID), restart the backend, or use email and password."
      }
      return err.message || "Service is temporarily unavailable. Try again in a moment."
    }
    if (err.code === "NETWORK_ERROR" || err.status === 0) {
      return err.message || fallback
    }
    return err.message || fallback
  }
  if (err && typeof err === "object" && "message" in err) {
    const m = String((err as { message?: string }).message || "")
    if (m) return m
  }
  return fallback
}
