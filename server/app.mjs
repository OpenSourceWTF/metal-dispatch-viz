import express from "express";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
  TraceRegistry,
  TraceRegistryError,
} from "./trace-registry.mjs";

const DEFAULT_TRACE_DIR = "./traces/showcase";
const DEFAULT_PORT = 4173;
const DEFAULT_HOST = "127.0.0.1";
const TRACE_ID_PATTERN = /^[a-f0-9]{24}$/;
export const DEFAULT_CLIENT_DIR = path.resolve(
  fileURLToPath(new URL("../dist/client/", import.meta.url)),
);

class RuntimeConfigError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RuntimeConfigError";
    this.code = code;
  }
}

function invalidArgument(message) {
  return new RuntimeConfigError(message, "INVALID_ARGUMENT");
}

function parseTraceDirectory(argv) {
  let configured;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--trace-dir") {
      if (configured !== undefined) {
        throw invalidArgument("--trace-dir may only be specified once.");
      }

      const value = argv[index + 1];
      if (
        typeof value !== "string" ||
        value.trim() === "" ||
        value.startsWith("--")
      ) {
        throw invalidArgument("--trace-dir requires a path value.");
      }

      configured = value;
      index += 1;
      continue;
    }

    if (typeof argument === "string" && argument.startsWith("--trace-dir=")) {
      if (configured !== undefined) {
        throw invalidArgument("--trace-dir may only be specified once.");
      }

      const value = argument.slice("--trace-dir=".length);
      if (value.trim() === "") {
        throw invalidArgument("--trace-dir requires a path value.");
      }

      configured = value;
      continue;
    }

    throw invalidArgument("Unknown command-line argument.");
  }

  return configured;
}

function parsePort(value) {
  const serialized = typeof value === "number" ? String(value) : value;
  if (
    typeof serialized !== "string" ||
    !/^[0-9]+$/.test(serialized)
  ) {
    throw new RuntimeConfigError(
      "PORT must be an integer from 1 through 65535.",
      "INVALID_PORT",
    );
  }

  const port = Number(serialized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new RuntimeConfigError(
      "PORT must be an integer from 1 through 65535.",
      "INVALID_PORT",
    );
  }
  return port;
}

function safeRootLabel(traceRoot) {
  const label = path.basename(traceRoot);
  return label === "" ? "trace-root" : label;
}

function filesystemPath(value) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return path.resolve(value);
  }
  throw new TypeError("publicDir must be a filesystem path or file URL.");
}

function traceNotFound(res) {
  return res.status(404).json({
    error: {
      code: "TRACE_NOT_FOUND",
      message: "Trace not found.",
    },
  });
}

function registryErrorResponse(error) {
  if (error instanceof TraceRegistryError) {
    return {
      status:
        error.code === "TRACE_ROOT_UNAVAILABLE"
          ? 503
          : 500,
      body: {
        error: {
          code: error.code ?? "REGISTRY_ERROR",
          message: error.message,
        },
      },
    };
  }

  if (error instanceof URIError && error.status === 400) {
    return {
      status: 400,
      body: {
        error: {
          code: "BAD_REQUEST",
          message: "The request path is malformed.",
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected server error occurred.",
      },
    },
  };
}

function attachmentHeader(filename) {
  if (typeof filename !== "string" || filename === "") {
    return undefined;
  }

  const safeFilename = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return safeFilename === ""
    ? undefined
    : `attachment; filename="${safeFilename}"`;
}

export function parseRuntimeConfig(
  argv = process.argv.slice(2),
  env = process.env,
) {
  if (!Array.isArray(argv)) {
    throw invalidArgument("Command-line arguments must be an array.");
  }

  const cliTraceDirectory = parseTraceDirectory(argv);
  const configuredTraceDirectory =
    cliTraceDirectory ??
    env?.TRACE_DIR ??
    DEFAULT_TRACE_DIR;
  if (
    typeof configuredTraceDirectory !== "string" ||
    configuredTraceDirectory.trim() === ""
  ) {
    throw invalidArgument("The trace directory must be a non-empty path.");
  }

  const traceRoot = path.resolve(configuredTraceDirectory);
  const port = parsePort(env?.PORT ?? String(DEFAULT_PORT));
  const configuredHost =
    typeof env?.HOST === "string" ? env.HOST.trim() : "";
  const host = configuredHost || DEFAULT_HOST;

  return {
    traceRoot,
    rootLabel: safeRootLabel(traceRoot),
    port,
    host,
  };
}

export function createApp({
  traceRoot,
  publicDir = DEFAULT_CLIENT_DIR,
}) {
  const registry = new TraceRegistry(traceRoot);
  const app = express();
  const staticRoot = filesystemPath(publicDir);

  app.disable("x-powered-by");
  app.locals.traceRegistry = registry;

  app.get("/api/health", async (_req, res) => {
    try {
      const payload = await registry.refresh();
      res.json({
        status: "ok",
        app: { status: "ok" },
        registry: {
          status: "ok",
          schemaVersion: payload.schemaVersion,
          rootLabel: payload.rootLabel,
          traceCount: payload.traces.length,
          warnings: payload.warnings,
        },
      });
    } catch (error) {
      const failure = registryErrorResponse(error);
      res.status(failure.status).json({
        status: "degraded",
        app: { status: "ok" },
        registry: {
          status: "error",
          error: failure.body.error,
        },
      });
    }
  });

  app.get("/api/traces", async (_req, res) => {
    const payload = await registry.refresh();
    res.json(payload);
  });

  app.get("/api/traces/:id", async (req, res, next) => {
    const { id } = req.params;
    if (typeof id !== "string" || !TRACE_ID_PATTERN.test(id)) {
      traceNotFound(res);
      return;
    }

    let opened;
    let stream;
    const destroyStream = () => {
      if (stream) {
        stream.destroy();
      } else if (opened) {
        void opened.fileHandle.close().catch(() => {});
      }
    };
    const handlePrematureResponseClose = () => {
      if (!res.writableFinished) {
        destroyStream();
      }
    };

    req.once("aborted", destroyStream);
    res.once("close", handlePrematureResponseClose);

    try {
      await registry.refresh();
      opened = await registry.open(id);
      if (!opened) {
        traceNotFound(res);
        return;
      }

      const disposition = attachmentHeader(opened.trace.name);
      if (disposition) {
        res.setHeader("Content-Disposition", disposition);
      }
      res.setHeader(
        "Content-Type",
        "application/x-ndjson; charset=utf-8",
      );
      res.setHeader("Cache-Control", "no-store");

      stream = opened.fileHandle.createReadStream({ autoClose: true });
      await pipeline(stream, res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }

      res.removeHeader("Content-Disposition");
      next(error);
    } finally {
      req.removeListener("aborted", destroyStream);
      res.removeListener("close", handlePrematureResponseClose);
      if (opened) {
        await opened.fileHandle.close().catch(() => {});
      }
    }
  });

  app.use(express.static(staticRoot, {
    fallthrough: true,
    index: "index.html",
    redirect: false,
  }));

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
      },
    });
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }

    const failure = registryErrorResponse(error);
    res.status(failure.status).json(failure.body);
  });

  return app;
}
