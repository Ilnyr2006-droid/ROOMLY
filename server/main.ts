import { startServer } from "./start.js";

const server = startServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("ROOMLY server shutdown failed.");
        process.exitCode = 1;
      }
    });
  });
}
