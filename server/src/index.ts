import path from "path";
import { loadServerEnv } from "./lib/load-server-env";

const { sources: envSources } = loadServerEnv();
console.log(
  `[env] dotenv: ${envSources.join(" -> ")} | cwd=${process.cwd()} | AD_TREAT_LOCALHOST_AS_NOVAPULSEAI=${process.env.AD_TREAT_LOCALHOST_AS_NOVAPULSEAI ?? "(unset)"}`
);

import http from "http";
import fs from "fs";
import net from "net";

import app from "./app";
import { prisma } from "./lib/prisma";
import { warnIfAdJobSchemaDrift } from "./lib/prisma-adjob-drift";
import { assertApiDatabaseReady } from "./lib/prisma-schema-health";
import { validateServerEnvironment } from "./lib/validate-server-env";
import { log, serializeErr } from "./lib/logger";
import { logYoutubeIngestStartupDiagnostics } from "./utils/youtube-ingest-prerequisites";
import { configureFluentFfmpeg } from "./lib/ffmpeg-binaries";
import { startEmailQueueWorker } from "./lib/email-outbound";
import { recoverPendingClipJobs } from "./modules/clip/clip.job.processor";

/* =====================================================
   ENV VALIDATION (all environments + production strict)
===================================================== */

validateServerEnvironment();
logYoutubeIngestStartupDiagnostics();
// Point fluent-ffmpeg (ads + clip) at a resolved binary BEFORE any route
// loads a module that uses it. Also emits the resolution source so operators
// can confirm at deploy time that the container has ffmpeg where expected.
configureFluentFfmpeg();

/* =====================================================
   PATHS
===================================================== */

const ROOT = process.cwd();
const GENERATED_DIR = path.resolve(ROOT, "generated");
const CLIPS_DIR = path.resolve(ROOT, "clips");
const TMP_DIR = path.resolve(ROOT, "tmp");

/* =====================================================
   ENSURE REQUIRED DIRECTORIES EXIST
===================================================== */

for (const dir of [GENERATED_DIR, CLIPS_DIR, TMP_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/* =====================================================
   SERVER CONFIG
===================================================== */

const rawPort = process.env.PORT ?? process.env.port;
const parsedPort = Number(rawPort);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 5000;
const NODE_ENV = process.env.NODE_ENV || "development";
/** Must match http listen host or the port probe can pass while ::5000 is still taken (EADDRINUSE). */
const LISTEN_HOST = process.env.LISTEN_HOST?.trim() || "0.0.0.0";
const server = http.createServer(app);

let shuttingDown = false;

/* =====================================================
   START SERVER
===================================================== */

async function start(): Promise<void> {
  try {
    const startTime = Date.now();

    const portAvailable = await new Promise<boolean>((resolve) => {
      const probe = net
        .createServer()
        .once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            resolve(false);
            return;
          }
          console.error("❌ Port probe failed:", err);
          resolve(false);
        })
        .once("listening", () => {
          probe.close(() => resolve(true));
        });

      probe.listen(PORT, LISTEN_HOST);
    });

    if (!portAvailable) {
      console.warn(
        `⚠️ Port ${PORT} (${LISTEN_HOST}) is already in use. Another API instance may be running.`
      );
      console.warn(
        "ℹ️ On Windows: netstat -ano | findstr :5000  then taskkill /PID <pid> /F"
      );
      process.exitCode = 1;
      process.exit(1);
      return;
    }

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `❌ Port ${PORT} (${LISTEN_HOST}) is already in use. Stop the other process or set PORT=5001 in .env`
        );
        console.error(
          "ℹ️ Find PID: netstat -ano | findstr :" + PORT
        );
        process.exitCode = 1;
        process.exit(1);
        return;
      }
      console.error("❌ Server error:", err);
      process.exitCode = 1;
      process.exit(1);
    });

    if (!process.env.DATABASE_URL?.trim()) {
      console.error(
        "❌ Missing DATABASE_URL. Set a PostgreSQL connection string in server/.env (see prisma/schema.prisma datasource)."
      );
      process.exit(1);
      return;
    }

    try {
      await assertApiDatabaseReady(prisma);
      if (process.env.PRISMA_SKIP_ADJOB_SCHEMA_CHECK !== "true") {
        await warnIfAdJobSchemaDrift();
      }
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      console.error("❌ Database not ready (connection or schema):", m);
      console.error(
        "ℹ️ If migrations are pending: cd server && npx prisma migrate deploy"
      );
      process.exit(1);
      return;
    }

    try {
      server.listen(PORT, LISTEN_HOST, () => {
        const duration = Date.now() - startTime;

        startEmailQueueWorker();
        void recoverPendingClipJobs().catch((err) => {
          log.error("clip_job_recovery_failed", serializeErr(err));
        });

        console.log(`
🚀 NovaPulseAI API
📦 PID: ${process.pid}
🌍 Environment: ${NODE_ENV}

📡 API: http://localhost:${PORT}
🧠 Health: http://localhost:${PORT}/health
🔎 Ready: http://localhost:${PORT}/readyz

🎬 Clips: http://localhost:${PORT}/clips/
🎥 Generated: http://localhost:${PORT}/generated/

⚡ Startup time: ${duration}ms
`);
      });
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "EADDRINUSE") {
        console.error(
          `❌ Port ${PORT} is already in use. Set PORT=5001 or free the port.`
        );
        process.exit(1);
        return;
      }
      throw err;
    }
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

void start();

/* =====================================================
   GRACEFUL SHUTDOWN
===================================================== */

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log("✅ Prisma disconnected.");
    } catch (err) {
      console.error("❌ Prisma disconnect error:", err);
    }

    console.log("✅ Server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("❌ Forced shutdown.");
    process.exit(1);
  }, 8000);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGUSR2", () => {
  void shutdown("SIGUSR2");
});

/* =====================================================
   GLOBAL ERROR HANDLING
===================================================== */

process.on("unhandledRejection", (reason) => {
  log.error("unhandled_rejection", {
    ...(reason instanceof Error ? serializeErr(reason) : { message: String(reason) }),
  });
});

process.on("uncaughtException", (error) => {
  log.error("uncaught_exception", serializeErr(error));
  void shutdown("uncaughtException");
});