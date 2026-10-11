import type { Server } from "node:http";
import { createApp } from "./app.js";

export interface StartServerOptions {
  port?: number;
  host?: string;
  databasePath?: string;
  staticDirectory?: string;
}

export function startServer(options: StartServerOptions = {}): Server {
  const port = options.port ?? Number(process.env.PORT ?? 3001);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const server = createApp({ databasePath: options.databasePath, staticDirectory: options.staticDirectory });
  server.listen(port, host, () => {
    console.log(`ROOMLY API listening on http://${host}:${port}`);
  });
  return server;
}
