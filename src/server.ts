import express from "express";
import bodyParser from "body-parser";
import bot, { setWebhook, loadActiveGames } from "./bot.js";
import { PORT, ADMIN_ID } from "./config.js";

const app = express();
app.use(bodyParser.json());

app.get("/health", (_req, res) => res.send({ ok: true }));

// Admin endpoints (protected by header x-admin-id === ADMIN_ID)
app.get("/admin/stats", async (req, res) => {
  const admin = req.header("x-admin-id") || req.query.admin;
  if (!admin || String(admin) !== ADMIN_ID) return res.status(403).send({ error: "forbidden" });
  try {
    const stats = await import("./metrics.js").then(m => m.getAdminStats());
    res.send(stats);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

app.get("/admin/transactions", async (req, res) => {
  const admin = req.header("x-admin-id") || req.query.admin;
  if (!admin || String(admin) !== ADMIN_ID) return res.status(403).send({ error: "forbidden" });
  const limit = Math.min(1000, Number(req.query.limit || 100));
  try {
    const tx = await import("./metrics.js").then(m => m.listTransactions(limit));
    res.send(tx);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    await bot.handleUpdate(req.body as any, res as any);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.listen(PORT, async () => {
  console.log(`Server listening on ${PORT}`);
  await setWebhook();
  await loadActiveGames();
});
