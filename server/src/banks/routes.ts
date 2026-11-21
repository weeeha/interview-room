import { Hono } from "hono";
import { bankDir, loadBanks } from "./load.ts";

// Lists banks without reference answers or guard lines.
export function banksRoutes(env: NodeJS.ProcessEnv = process.env): Hono {
  const app = new Hono();
  app.get("/api/banks", (c) => {
    const banks = loadBanks(bankDir(env)).map((b) => ({ id: b.id, title: b.title, questionCount: b.questions.length }));
    return c.json({ banks });
  });
  return app;
}
