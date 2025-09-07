const config = {
  BOT_TOKEN: process.env.BOT_TOKEN || process.env.NEXT_PUBLIC_BOT_TOKEN || '',
  DATABASE_URL: process.env.DATABASE_URL || process.env.NEON_URL || '',
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
  ADMIN_ID: process.env.ADMIN_ID || '',
  PORT: Number(process.env.PORT || 3000),
};

if (!config.BOT_TOKEN) throw new Error('BOT_TOKEN не задан. Задайте переменную окружения BOT_TOKEN.');
if (!config.DATABASE_URL) throw new Error('DATABASE_URL не задан. Задайте переменную окружения DATABASE_URL.');

module.exports = config;
