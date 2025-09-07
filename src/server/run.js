const config = require('../config');
const { createServer } = require('./webhook');

async function run() {
  const { app, bot } = createServer();

  const port = process.env.PORT || config.PORT || 3000;
  app.listen(port, async () => {
    console.log(`Server listening on port ${port}`);

    if (config.WEBHOOK_URL) {
      try {
        const webhookUrl = config.WEBHOOK_URL.replace(/\/$/, '') + '/webhook';
        await bot.telegram.setWebhook(webhookUrl);
        console.log('Webhook set to', webhookUrl);
      } catch (e) {
        console.error('Failed to set webhook:', e?.message || e);
      }
    } else {
      console.log('WEBHOOK_URL not set — using long polling (not configured)');
    }
  });
}

run().catch(err => {
  console.error('Failed to start server', err);
  process.exit(1);
});
