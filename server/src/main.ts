import { serve } from "@hono/node-server";
import { createApp } from "./index.ts";
import { createLogger } from "./log.ts";

const log = createLogger("server");
const port = Number(process.env.PORT || 8941);

serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" }, (info) => {
  log.info(`voice server listening on http://127.0.0.1:${info.port}`);
});
