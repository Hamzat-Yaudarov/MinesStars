const { Telegraf } = require('telegraf');
const config = require('../config');
const prisma = require('../db/prisma');
const { performMine, RESOURCES } = require('../services/miningService');
const { animateText } = require('../utils/animation');

function formatInventory(inventory) {
  if (!inventory || inventory.length === 0) return 'Пусто';
  return inventory.map(i => `${i.resource}: ${i.amount}`).join('\n');
}

async function ensureUser(ctx) {
  const tg = ctx.from;
  let user = await prisma.user.findUnique({ where: { telegramId: String(tg.id) } });
  if (!user) {
    user = await prisma.user.create({ data: { telegramId: String(tg.id), username: tg.username || null, balanceStars: 0, balanceCoins: 0, pickaxeLevel: 0 } });
  }
  return user;
}

function createStubBot() {
  console.warn('Создан stub-бот: BOT_TOKEN отсутствует. Стандартные команды недоступны.');
  return {
    handleUpdate: async () => {},
    telegram: {
      async setWebhook() { console.warn('setWebhook called on stub bot'); }
    },
    on() {},
    command() {},
    start() {},
  };
}

function createBot() {
  if (config.MISSING_BOT_TOKEN) {
    return createStubBot();
  }

  const bot = new Telegraf(config.BOT_TOKEN);

  bot.start(async (ctx) => {
    const user = await ensureUser(ctx);
    await ctx.reply(`Добро пожаловать, ${ctx.from.first_name}!\nВведите /profile чтобы открыть профиль.`);
  });

  bot.command('profile', async (ctx) => {
    const user = await ensureUser(ctx);
    const inventory = await prisma.inventory.findMany({ where: { userId: BigInt(user.id) } });
    const text = `Профиль:\nИмя: ${ctx.from.first_name}\nУровень кирки: ${user.pickaxeLevel}\nБаланс (звёзды): ${user.balanceStars}\nБаланс (коины): ${user.balanceCoins}\n\nИнвентарь:\n${formatInventory(inventory)}`;
    await ctx.reply(text);
  });

  bot.command('mine', async (ctx) => {
    const user = await ensureUser(ctx);
    const now = new Date();
    if (user.lastMineAt) {
      const diff = now - new Date(user.lastMineAt);
      const hours = diff / (1000 * 60 * 60);
      if (hours < 3) {
        const left = Math.ceil(3 - hours);
        await ctx.reply(`Пока нельзя копать. Подождите примерно ${left} ч.`);
        return;
      }
    }

    await animateText(ctx, 'Копаю...');
    const loot = await performMine(user);
    if (Object.keys(loot).length === 0) {
      await ctx.reply('К сожалению, ничего не найдено. Попробуйте позже.');
      return;
    }

    const lines = Object.entries(loot).map(([k, v]) => {
      const res = RESOURCES.find(r => r.key === k);
      return `${res.label}: ${v}`;
    });
    await ctx.reply('Вы получили:\n' + lines.join('\n'));
  });

  bot.command('shop', async (ctx) => {
    const text = `Магазин:\n/купить_кирку - купить первую кирку (10 000 коинов)\n/улучшить_кирку - улучшить кирку до следующего уровня`;
    await ctx.reply(text);
  });

  bot.command('купить_кирку', async (ctx) => {
    const user = await ensureUser(ctx);
    const price = 10000;
    if (user.balanceCoins < price) {
      await ctx.reply('Недостаточно коинов для покупки кирки.');
      return;
    }
    await prisma.user.update({ where: { id: BigInt(user.id) }, data: { pickaxeLevel: 1, balanceCoins: user.balanceCoins - BigInt(price) } });
    await ctx.reply('Поздравляем! Вы получили кирку уровня 1.');
  });

  bot.command('улучшить_кирку', async (ctx) => {
    const user = await ensureUser(ctx);
    const level = user.pickaxeLevel || 0;
    const prices = [0, 10000, 50000, 100000, 150000, 200000, 250000, 300000, 350000, 400000, 500000];
    if (level >= 10) {
      await ctx.reply('Вы уже достигли максимального уровня кирки.');
      return;
    }
    const nextPrice = prices[level + 1] || prices[prices.length - 1];
    if (user.balanceCoins < nextPrice) {
      await ctx.reply(`Недостаточно коинов. Нужно ${nextPrice} коинов.`);
      return;
    }
    await prisma.user.update({ where: { id: BigInt(user.id) }, data: { pickaxeLevel: level + 1, balanceCoins: user.balanceCoins - BigInt(nextPrice) } });
    await ctx.reply(`Кирка улучшена до уровня ${level + 1}.`);
  });

  // обработка оплаты Stars и pre_checkout
  bot.on('pre_checkout_query', async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
      console.error('pre_checkout_query error', e);
    }
  });

  bot.on('successful_payment', async (ctx) => {
    const user = await ensureUser(ctx);
    const amount = BigInt(ctx.message.successful_payment.total_amount);
    // Telegram Stars amount unit specifics: assume amount is in smallest unit provided by Telegram
    await prisma.user.update({ where: { id: BigInt(user.id) }, data: { balanceStars: user.balanceStars + amount } });
    await ctx.reply('Платёж успешно зачислен на баланс.');
  });

  return bot;
}

module.exports = { createBot };
