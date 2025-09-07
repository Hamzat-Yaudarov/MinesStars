const env = process.env;

// Поддерживаем несколько вариантов названий переменных для гибкости
const BOT_TOKEN = env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || env.NEXT_PUBLIC_BOT_TOKEN || '';
const DATABASE_URL = env.DATABASE_URL || env.NEON_URL || env.DATABASE || '';
const WEBHOOK_URL = env.WEBHOOK_URL || env.WEBHOOK || '';
const ADMIN_ID = env.ADMIN_ID || env.ADMIN || '';
const PORT = Number(env.PORT || 3000);

const config = {
  BOT_TOKEN,
  DATABASE_URL,
  WEBHOOK_URL,
  ADMIN_ID,
  PORT,
};

function maskValue(v) {
  if (!v) return null;
  return v.length > 10 ? `${v.slice(0,4)}...${v.slice(-4)} (len=${v.length})` : v;
}

if (!config.BOT_TOKEN) {
  // Логируем доступные похожие переменные окружения чтобы помочь отладить проблему в Railway
  const keys = Object.keys(env).filter(k => /BOT|TOKEN|TELEGRAM/i.test(k));
  console.error('Отсутствует BOT_TOKEN. Похожие переменные окружения:', keys);
  const sample = keys.map(k => `${k}=${maskValue(env[k])}`);
  if (sample.length) console.error('Найдены (замаскировано):', sample.join(', '));
  console.error('Продолжаю запуск сервера без BOT_TOKEN — бот не сможет работать пока переменная не установлена.');
  // не бросаем ошибку, экспортируем флаг отсутствия
  config.MISSING_BOT_TOKEN = true;
}

if (!config.DATABASE_URL) {
  console.error('DATABASE_URL отсутствует. Проверенные ключи: NEON_URL, DATABASE_URL.');
  // экспортируем флаг, но не падаем жёстко — в dev можно продолжать
  config.MISSING_DATABASE_URL = true;
}

module.exports = config;
