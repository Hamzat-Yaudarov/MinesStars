const express = require('express');
const { createBot } = require('../bot/bot');
const config = require('../config');

function createServer() {
  const app = express();
  const bot = createBot();

  app.use(express.json());
  app.post('/webhook', (req, res, next) => {
    bot.handleUpdate(req.body, res).catch(next);
    res.status(200).send('ok');
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  return { app, bot };
}

module.exports = { createServer };
