import { Bot, Context, InlineKeyboard } from "grammy";
import prisma from "./db.js";
import { BOT_TOKEN, WEBHOOK_URL, ADMIN_ID } from "./config.js";
import { performMine, ResourceKey } from "./game.js";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required in env");

export const bot = new Bot(BOT_TOKEN);

async function ensureUser(ctx: Context) {
  const tg = ctx.from;
  if (!tg) return null;
  const telegramId = BigInt(tg.id);
  let user = await prisma.user.findUnique({ where: { telegramId } as any });
  if (!user) {
    user = await prisma.user.create({ data: { telegramId, username: tg.username || undefined } });
  }
  return user;
}

function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("⛏️ Копать", "action:mine").row()
    .text("👤 Профиль", "action:profile").row()
    .text("🎒 Инвентарь", "action:inventory").row()
    .text("🎁 Кейсы", "action:cases").row()
    .text("🛒 Магазин", "action:shop").text("💸 Вывод", "action:withdraw");
}

bot.command("start", async (ctx) => {
  await ensureUser(ctx);
  await ctx.reply("Добро пожаловать в Mines Stars! Используйте кнопки ниже:", {
    reply_markup: mainMenuKeyboard()
  });
});

const COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

bot.callbackQuery(/action:(.+)/, async (ctx) => {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  const parts = data.split(":");
  const action = parts[1];
  await ctx.answerCallbackQuery();
  const user = await ensureUser(ctx as any);
  if (!user) return ctx.api.sendMessage(ctx.chat!.id, "Нужно начать: нажмите /start");

  switch (action) {
    case "mine": {
      const now = new Date();
      if (user.lastMineAt) {
        const diff = now.getTime() - user.lastMineAt.getTime();
        if (diff < COOLDOWN_MS) {
          const minutes = Math.ceil((COOLDOWN_MS - diff) / 60000);
          return ctx.api.sendMessage(ctx.chat!.id, `Ещё не прошло 3 часа. Попробуйте через ${minutes} минут.`);
        }
      }

      // initial feedback
      await ctx.api.sendMessage(ctx.chat!.id, "Коп начат... ⛏️");

      const res = performMine(user.pickaxeLevel);

      await prisma.user.update({ where: { id: user.id }, data: { lastMineAt: now, minesCoin: BigInt(Number(user.minesCoin) + res.coins) } });

      const existing = await prisma.userResource.findUnique({ where: { userId_resource: { userId: user.id, resource: res.resource } } }).catch(() => null);
      if (existing) {
        await prisma.userResource.update({ where: { userId_resource: { userId: user.id, resource: res.resource } }, data: { amount: BigInt(Number(existing.amount) + res.amount) } });
      } else {
        await prisma.userResource.create({ data: { userId: user.id, resource: res.resource, amount: BigInt(res.amount) } });
      }

      // animated sequence using a single editable message to avoid spam
      const animMsg = await ctx.api.sendMessage(ctx.chat!.id, `Коп начат... ⛏️`);
      const steps = [
        `Вы копаете... ⛏️`,
        `Вы нашли: ${res.amount} ${humanize(res.resource)}!`,
        `Зачислено: ${res.coins} Mines Coin (курс: 200 MC = 1 STARS)`
      ];
      const interval = 800;
      for (let i = 0; i < steps.length; i++) {
        setTimeout(() => {
          ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, steps[i]).catch(() => {});
        }, interval * (i + 1));
      }
      // finalize: attach main menu and store transaction
      setTimeout(async () => {
        try {
          await ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, `Вы получили: ${res.amount} ${humanize(res.resource)}\nЗачислено: ${res.coins} Mines Coin (курс: 200 MC = 1 STARS)`, { reply_markup: mainMenuKeyboard() } as any);
        } catch (e) {}
        await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(res.coins), type: "mine", meta: JSON.stringify({ resource: res.resource, amount: res.amount }) } });
      }, interval * (steps.length + 1));
      break;
    }

    case "profile": {
      const u = await prisma.user.findUnique({ where: { id: user.id }, include: { inventory: true } });
      const invSummary = u!.inventory.map(i => `${humanize(i.resource)}: ${i.amount}`).join("\n") || "пусто";
      await ctx.api.sendMessage(ctx.chat!.id, `Профиль:\n👤 @${u!.username || "(не задан)"}\n🔹 Уровень кирки: ${u!.pickaxeLevel}\n💰 Mines Coin: ${u!.minesCoin}\n⭐ Stars: ${u!.starsBalance}\n⏱ Последний коп: ${u!.lastMineAt?.toISOString() || "никогда"}\n\nИнвентарь:\n${invSummary}`, {
        reply_markup: mainMenuKeyboard()
      });
      break;
    }

    case "inventory": {
      const u = await prisma.user.findUnique({ where: { id: user.id }, include: { inventory: true } });
      const invLines = u!.inventory.map(i => `${humanize(i.resource)}: ${i.amount}`).join("\n") || "пусто";
      await ctx.api.sendMessage(ctx.chat!.id, `Инвентарь:\n${invLines}`, { reply_markup: mainMenuKeyboard() });
      break;
    }

    case "cases": {
      const kb = new InlineKeyboard()
        .text("🎁 Бесплатный (требует пополнение 200⭐ сегодня)", "action:case_free").row()
        .text("📦 Кейс 150⭐", "action:case2").row()
        .text("💎 Кейс 250⭐", "action:case3").row()
        .text("🔙 В меню", "action:menu");
      await ctx.api.sendMessage(ctx.chat!.id, "Выберите кейс:", { reply_markup: kb });
      break;
    }

    case "case_free": {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const deposits = await prisma.transaction.findMany({ where: { userId: user.id, type: "deposit", createdAt: { gte: startOfDay } } });
      const totalDepositedToday = deposits.reduce((s, d) => s + Number(d.amount), 0);
      if (totalDepositedToday < 200) return ctx.api.sendMessage(ctx.chat!.id, "Для получения бесплатного кейса нужно пополнить баланс на 200 звёзд сегодня.");
      if (user.lastFreeCaseAt) {
        const last = user.lastFreeCaseAt;
        if (last >= startOfDay) return ctx.api.sendMessage(ctx.chat!.id, "Вы уже открывали бесплатный кейс сегодня.");
      }
      const animMsg = await ctx.api.sendMessage(ctx.chat!.id, "Открываем бесплатный кейс... 🎁");
      const steps = ["...", "🔹 Лот...", "🔸 Подбираем...", "🎉 Открываем!"];
      const interval = 600;
      for (let i = 0; i < steps.length; i++) {
        setTimeout(() => {
          ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, steps[i]).catch(() => {});
        }, interval * (i + 1));
      }
      const reward = randInt(10, 75);
      setTimeout(async () => {
        await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) + reward), lastFreeCaseAt: new Date() } });
        await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(reward), type: "case_free", meta: String(reward) } });
        await ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, `Вы получили ${reward} ⭐`, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
      }, interval * (steps.length + 1));
      break;
    }

    case "case2": {
      // cost 150 stars
      if (Number(user.starsBalance) < 150) return ctx.api.sendMessage(ctx.chat!.id, "Недостаточно звёзд для открытия кейса (150)");
      await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) - 150) } });
      const rewards = [0,15,25,50,100,200,225];
      const weights = [40,20,15,10,8,5,2];
      const choice = weightedChoice(rewards, weights);
      const animMsg = await ctx.api.sendMessage(ctx.chat!.id, "Открываем кейс за 150 ⭐...");
      // short animation
      setTimeout(() => ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, "Крутится барабан... 🎰").catch(() => {}), 500);
      setTimeout(async () => {
        if (choice === 0) {
          await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(0), type: "case2", meta: JSON.stringify({ reward: 0 }) } });
          await ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, `Увы, ничего не выпало.`, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
        } else {
          await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number((await prisma.user.findUnique({ where: { id: user.id } }))!.starsBalance) + choice) } });
          await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(choice), type: "case2", meta: String(choice) } });
          await ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, `Поздравляем! Вы получили ${choice} ⭐`, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
        }
      }, 1500);
      break;
    }

    case "case3": {
      if (Number(user.starsBalance) < 250) return ctx.api.sendMessage(ctx.chat!.id, "Недостаточно звёзд для открытия кейса (250)");
      await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) - 250) } });
      const rewards = [100,150,175,275,300,350];
      const weights = [40,25,15,12,6,2];
      const choice = weightedChoice(rewards, weights);
      const animMsg = await ctx.api.sendMessage(ctx.chat!.id, "Открываем элитный кейс за 250 ⭐...");
      setTimeout(() => ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, "Вихрь наград... 🌪️").catch(() => {}), 500);
      setTimeout(async () => {
        await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number((await prisma.user.findUnique({ where: { id: user.id } }))!.starsBalance) + choice) } });
        await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(choice), type: "case3", meta: String(choice) } });
        await ctx.api.editMessageText(ctx.chat!.id, animMsg.message_id, `🎉 Вы получили ${choice} ⭐`, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
      }, 1500);
      break;
    }

    case "shop": {
      // simple shop: buy next pickaxe level
      const current = user.pickaxeLevel;
      const nextLevel = current + 1;
      const costs = [0,10000,50000,100000,150000,200000,250000,300000,350000,400000,500000];
      if (current >= 10) return ctx.api.sendMessage(ctx.chat!.id, "У вас уже максимальная кирка", { reply_markup: mainMenuKeyboard() });
      const price = costs[nextLevel];
      const kb = new InlineKeyboard().text(`Купить кирку уровня ${nextLevel} за ${price} MC`, `action:buy_pickaxe:${nextLevel}`).row().text("🔙 В меню", "action:menu");
      await ctx.api.sendMessage(ctx.chat!.id, `Магазин:\nУ вас кирка уровня ${current}\n`, { reply_markup: kb });
      break;
    }

    case "buy_pickaxe": {
      // callback might include level
      const level = parts[2] ? Number(parts[2]) : user.pickaxeLevel + 1;
      const costs = [0,10000,50000,100000,150000,200000,250000,300000,350000,400000,500000];
      const price = costs[level];
      if (Number(user.minesCoin) < price) return ctx.api.sendMessage(ctx.chat!.id, `Недостаточно Mines Coin. Нужно ${price}`, { reply_markup: mainMenuKeyboard() });
      await prisma.user.update({ where: { id: user.id }, data: { pickaxeLevel: level, minesCoin: BigInt(Number(user.minesCoin) - price) } });
      await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(price), type: "buy_pickaxe", meta: String(level) } });
      await ctx.api.sendMessage(ctx.chat!.id, `Вы успешно купили кирку уровня ${level}!`, { reply_markup: mainMenuKeyboard() });
      break;
    }

    case "withdraw": {
      const kb = new InlineKeyboard()
        .text("100 ⭐ (требует 110) ", "action:w_100").row()
        .text("250 ⭐ (требует 275)", "action:w_250").row()
        .text("500 ⭐ (требует 550)", "action:w_500").row()
        .text("1000 ⭐ (требует 1100)", "action:w_1000").row()
        .text("2500 ⭐ (требует 2750)", "action:w_2500").row()
        .text("10000 ⭐ (требует 11000)", "action:w_10000").row()
        .text("🔙 В меню", "action:menu");
      await ctx.api.sendMessage(ctx.chat!.id, "Выберите сумму для вывода:", { reply_markup: kb });
      break;
    }

    case "menu": {
      await ctx.api.sendMessage(ctx.chat!.id, "Главное меню:", { reply_markup: mainMenuKeyboard() });
      break;
    }

    default: {
      // handle withdrawal actions and others
      if (action.startsWith("w_")) {
        const amount = Number(action.split("_")[1]);
        const required = Math.floor(amount * 1.1);
        if (Number(user.starsBalance) < required) return ctx.api.sendMessage(ctx.chat!.id, `Для вывода ${amount}⭐ нужно ${required}⭐ на балансе.`);
        await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) - required) } });
        await prisma.withdrawalRequest.create({ data: { userId: user.id, amount: BigInt(amount), fee: 10, status: "pending" } });
        await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(-required), type: "withdraw_request", meta: String(amount) } });
        await ctx.api.sendMessage(ctx.chat!.id, `Заявка на вывод ${amount}⭐ принята. Комиссия 10% (${required - amount}⭐).`, { reply_markup: mainMenuKeyboard() });
      } else {
        await ctx.api.sendMessage(ctx.chat!.id, "Неизвестное действие", { reply_markup: mainMenuKeyboard() });
      }
      break;
    }
  }
});

function humanize(key: ResourceKey | string) {
  switch (key) {
    case "coal":
      return "Уголь";
    case "copper":
      return "Медь";
    case "iron":
      return "Железо";
    case "gold":
      return "Золото";
    case "diamond":
      return "Алмаз";
    default:
      return String(key);
  }
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedChoice(items: number[], weights: number[]) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

bot.on("pre_checkout_query", async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error(e);
  }
});

bot.on("message:successful_payment", async (ctx) => {
  const msg = ctx.message;
  if (!msg.successful_payment) return;
  const telegramId = BigInt(ctx.from!.id);
  const payload = msg.successful_payment.invoice_payload;
  const amount = Number(msg.successful_payment.total_amount || 0);
  const user = await prisma.user.findUnique({ where: { telegramId } as any });
  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) + amount) } });
    await ctx.reply("Платёж получен и зачислен на баланс.");
    await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(amount), type: "deposit", meta: payload } });
    if (user.referrerId) {
      const refBonus = Math.floor(amount * 0.05);
      await prisma.user.update({ where: { id: user.referrerId }, data: { starsBalance: BigInt(Number((await prisma.user.findUnique({ where: { id: user.referrerId } }))!.starsBalance) + refBonus) } });
    }
  }
});

export async function setWebhook() {
  if (!WEBHOOK_URL) return;
  const url = `${WEBHOOK_URL}/webhook`;
  try {
    await bot.api.setWebhook(url);
    console.log("Webhook set to", url);
  } catch (e) {
    console.error("Failed to set webhook", e);
  }
}

export default bot;
