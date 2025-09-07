const express = require('express');
const { createBot } = require('../bot/bot');
const config = require('../config');

function maskValue(v) {
  if (!v) return null;
  return v.length > 10 ? `${v.slice(0,4)}...${v.slice(-4)} (len=${v.length})` : v;
}

function createServer() {
  const app = express();
  const bot = createBot();

  app.use(express.json());
  app.post('/webhook', (req, res, next) => {
    try {
      bot.handleUpdate(req.body, res).catch(next);
    } catch (e) {
      // stub bot may not implement handleUpdate as promise
    }
    res.status(200).send('ok');
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.get('/diag', (req, res) => {
    res.json({
      BOT_TOKEN: maskValue(config.BOT_TOKEN),
      DATABASE_URL: maskValue(config.DATABASE_URL),
      WEBHOOK_URL: maskValue(config.WEBHOOK_URL),
      MISSING_BOT_TOKEN: !!config.MISSING_BOT_TOKEN,
      MISSING_DATABASE_URL: !!config.MISSING_DATABASE_URL,
    });
  });

  return { app, bot };
}

module.exports = { createServer };
