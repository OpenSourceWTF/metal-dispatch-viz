import { pathToFileURL } from "node:url";

import {
  createApp,
  parseRuntimeConfig,
} from "./server/app.mjs";

function displayHost(host) {
  return host.includes(":") ? `[${host}]` : host;
}

export function startServer(
  config = parseRuntimeConfig(),
  { logger = console } = {},
) {
  const app = createApp({ traceRoot: config.traceRoot });
  const server = app.listen(config.port, config.host, () => {
    const address = server.address();
    const port =
      address && typeof address === "object"
        ? address.port
        : config.port;
    logger.log(
      `metal-dispatch-viz listening at http://${displayHost(config.host)}:${port}`,
    );
    logger.log(`Trace root: ${config.rootLabel}`);
  });

  return server;
}

export function installGracefulShutdown(
  server,
  { logger = console } = {},
) {
  let closing = false;

  const shutdown = (signal) => {
    if (closing) {
      return;
    }
    closing = true;
    logger.log(`Received ${signal}; closing server.`);

    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    server.close((error) => {
      if (error) {
        logger.error(`Server close failed: ${error.code ?? "CLOSE_ERROR"}`);
        process.exitCode = 1;
      }
    });
  };
  const onSigint = () => shutdown("SIGINT");
  const onSigterm = () => shutdown("SIGTERM");

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return () => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  };
}

function isMainModule() {
  return (
    typeof process.argv[1] === "string" &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  try {
    const config = parseRuntimeConfig();
    const server = startServer(config);
    installGracefulShutdown(server);
    server.once("error", (error) => {
      console.error(`Server failed to listen: ${error.code ?? "LISTEN_ERROR"}`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(
      `Configuration error [${error.code ?? "INVALID_CONFIG"}]: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
