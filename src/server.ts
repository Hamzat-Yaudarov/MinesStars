import express from "express";
import bodyParser from "body-parser";
import bot, { setWebhook } from "./bot.js";
import { PORT } from "./config.js";

const app = express();
app.use(bodyParser.json());

app.get("/health", (_req, res) => res.send({ ok: true }));

app.post("/webhook", async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.listen(PORT, async () => {
  console.log(`Server listening on ${PORT}`);
  await setWebhook();
});
