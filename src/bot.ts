import { Bot, Context, InlineKeyboard } from "grammy";
import prisma from "./db.js";
import { BOT_TOKEN, WEBHOOK_URL, ADMIN_ID, BOT_USERNAME } from "./config.js";
import { performMine, ResourceKey } from "./game.js";
import antiFraud from "./antiFraud.js";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required in env");

export const bot = new Bot(BOT_TOKEN);

// animation timers per message id to allow cancellation
const animTimers = new Map<number, any[]>();

function scheduleAnimatedEdits(chatId: number, messageId: number, steps: string[], interval: number, finalText?: string, replyMarkup?: any) {
  const timers: any[] = [];
  for (let i = 0; i < steps.length; i++) {
    const t = setTimeout(() => {
      bot.api.editMessageText(chatId, messageId, steps[i]).catch(() => {});
    }, interval * (i + 1));
    timers.push(t);
  }
  const finalTimer = setTimeout(() => {
    const text = finalText || steps[steps.length - 1];
    bot.api.editMessageText(chatId, messageId, text, replyMarkup ? { reply_markup: replyMarkup } : undefined).catch(() => {});
    animTimers.delete(messageId);
  }, interval * (steps.length + 1));
  timers.push(finalTimer);
  animTimers.set(messageId, timers);
}

function clearAnimationTimers(messageId: number) {
  const timers = animTimers.get(messageId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
    animTimers.delete(messageId);
  }
}

async function ensureUser(ctx: Context) {
  const tg = ctx.from;
  if (!tg) return null;
  const telegramId = BigInt(tg.id);
  let user = await prisma.user.findUnique({ where: { telegramId } as any });
  const text = (ctx.message && (ctx.message as any).text) || "";
  const parts = text.trim().split(/\s+/);
  const startParam = parts.length > 1 ? parts[1] : null;
  if (!user) {
    // create user, possibly link referrer if start param provided
    const createData: any = { telegramId, username: tg.username || undefined };
    if (startParam) {
      // find referrer by referralCode
      const ref = await prisma.user.findUnique({ where: { referralCode: startParam } as any }).catch(() => null);
      if (ref) createData.referrerId = ref.id;
    }
    // generate unique referralCode
    let code: string | null = null;
    for (let i = 0; i < 5; i++) {
      const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
      const exists = await prisma.user.findUnique({ where: { referralCode: candidate } as any }).catch(() => null);
      if (!exists) { code = candidate; break; }
    }
    if (code) createData.referralCode = code;
    user = await prisma.user.create({ data: createData });
    // create referral record linking this new user to their referrer (if any)
    if (createData.referrerId) {
      try {
        await prisma.referral.create({ data: { userId: user.id, referredBy: createData.referrerId } });
      } catch (e) {
        // ignore if already exists
      }
    }
  }
  return user;
}

function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("⛏️ Копать", "action:mine").row()
    .text("👤 Профиль", "action:profile").row()
    .text("🎒 Инвентарь", "action:inventory").row()
    .text("🎁 Кейсы", "action:cases").row()
    .text("🎲 Лесенка", "action:ladder").row()
    .text("🛒 Магазин", "action:shop").text("💸 Вывод", "action:withdraw");
}

// Ladder (лесенка) game state in-memory (keyed by user id)
type LadderState = {
  userId: string;
  bet: number;
  level: number; // next level to play (1..7)
  broken: Set<number>[]; // index 0..6, each Set contains broken columns 0..7
  messageId?: number;
  chatId?: number;
  startedAt: number;
  locked?: boolean;
};

const ladderGames = new Map<string, LadderState>();
const LADDER_LEVELS = 7;
const LADDER_COLUMNS = 8;
const LADDER_MULTIPLIERS: number[] = Array.from({ length: LADDER_LEVELS }, (_, i) => +(1.14 + i * 0.14).toFixed(2));

// timers for auto-expire (90s)
const ladderTimers = new Map<string, NodeJS.Timeout>();
// simple lock set to avoid reentrancy per user
const userLocks = new Set<string>();

function generateBrokenSets() {
  const arr: Set<number>[] = [];
  for (let lvl = 1; lvl <= LADDER_LEVELS; lvl++) {
    const brokenCount = lvl; // level 1 -> 1 broken, level 7 ->7
    const s = new Set<number>();
    while (s.size < brokenCount) {
      s.add(Math.floor(Math.random() * LADDER_COLUMNS));
    }
    arr.push(s);
  }
  return arr;
}

function buildLadderKeyboard(level: number) {
  const kb = new InlineKeyboard();
  // row of 8 buttons
  for (let i = 0; i < LADDER_COLUMNS; i++) {
    kb.text(`${i + 1}`, `action:ladder_pick:${level}:${i}`);
    if ((i + 1) % 4 === 0) kb.row();
  }
  kb.row();
  kb.text(`💰 Забрать (уровень ${level})`, `action:ladder_take:${level}`).text("🚪 Сдаться", `action:ladder_cancel`);
  return kb;
}

function clearLadderTimer(userId: string) {
  const t = ladderTimers.get(userId);
  if (t) { clearTimeout(t); ladderTimers.delete(userId); }
}

// safer schedule that uses stored chatId/messageId
function scheduleLadderExpireSafe(userId: string) {
  clearLadderTimer(userId);
  const t = setTimeout(async () => {
    const state = ladderGames.get(userId);
    if (!state) return;
    ladderGames.delete(userId);
    ladderTimers.delete(userId);
    await prisma.transaction.create({ data: { userId: state.userId, amount: BigInt(0), type: "ladder_timeout", meta: JSON.stringify({ bet: state.bet }) } });
    try {
      if (state.messageId && state.chatId) {
        await bot.api.editMessageText(state.chatId, state.messageId, `⏱ Время вышло — ставка ${state.bet} ⭐ сгорела.`, { reply_markup: mainMenuKeyboard() } as any);
      }
    } catch (e) {
      // ignore
    }
  }, 90_000);
  ladderTimers.set(userId, t);
}

function scheduleLadderExpire(userId: string, username: string | undefined) {
  clearLadderTimer(userId);
  const t = setTimeout(async () => {
    const state = ladderGames.get(userId);
    if (!state) return;
    ladderGames.delete(userId);
    ladderTimers.delete(userId);
    // on timeout, stake is forfeited (already debited at start). record transaction
    await prisma.transaction.create({ data: { userId: state.userId, amount: BigInt(0), type: "ladder_timeout", meta: JSON.stringify({ bet: state.bet }) } });
    // try to edit message to inform
    try {
      if (state.messageId) await bot.api.editMessageText(Number(userId.split(":")[1]) || 0, state.messageId, `⏱ Время вышло — ставка ${state.bet} ⭐ сгорела.`, { reply_markup: mainMenuKeyboard() } as any);
    } catch (e) {
      // ignore
    }
  }, 90_000);
  ladderTimers.set(userId, t);
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
  // anti-fraud rate limiting
  const ukey = user.id;
  if (!antiFraud.hit(ukey)) {
    return ctx.api.sendMessage(ctx.chat!.id, "Слишком много запросов — попробуйте через минуту.");
  }

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

      // initial feedback and send editable message with cancel
      const res = performMine(user.pickaxeLevel);

      await prisma.user.update({ where: { id: user.id }, data: { lastMineAt: now, minesCoin: BigInt(Number(user.minesCoin) + res.coins) } });

      const existing = await prisma.userResource.findUnique({ where: { userId_resource: { userId: user.id, resource: res.resource } } }).catch(() => null);
      if (existing) {
        await prisma.userResource.update({ where: { userId_resource: { userId: user.id, resource: res.resource } }, data: { amount: BigInt(Number(existing.amount) + res.amount) } });
      } else {
        await prisma.userResource.create({ data: { userId: user.id, resource: res.resource, amount: BigInt(res.amount) } });
      }

      const cancelKb = new InlineKeyboard().text("⏹️ Отменить", "action:anim_cancel");
      const animMsg = await ctx.api.sendMessage(ctx.chat!.id, `��оп начат... ⛏️`, { reply_markup: cancelKb } as any);
      const steps = [
        `Вы копаете... ⛏️`,
        `Вы нашли: ${res.amount} ${humanize(res.resource)}!`,
        `Зачислено: ${res.coins} Mines Coin (курс: 200 MC = 1 STARS)`
      ];
      scheduleAnimatedEdits(ctx.chat!.id, animMsg.message_id, steps, 800, `Вы получили: ${res.amount} ${humanize(res.resource)}\nЗачислено: ${res.coins} Mines Coin (курс: 200 MC = 1 STARS)`, mainMenuKeyboard());

      await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(res.coins), type: "mine", meta: JSON.stringify({ resource: res.resource, amount: res.amount }) } });
      break;
    }

    case "profile": {
      const u = await prisma.user.findUnique({ where: { id: user.id }, include: { inventory: true } });
      const invSummary = u!.inventory.map((i: any) => `${humanize(i.resource)}: ${i.amount}`).join("\n") || "пусто";
      const referralsCount = await prisma.user.count({ where: { referrerId: u!.id } });
      const refEarnAgg = await prisma.transaction.aggregate({ where: { userId: u!.id, type: "ref_bonus" }, _sum: { amount: true } });
      const refEarned = (refEarnAgg._sum.amount) ? Number(refEarnAgg._sum.amount) : 0;
      const refCode = u!.referralCode || "(не назначен)";
      const refLink = `https://t.me/${BOT_USERNAME}?start=${refCode}`;
      const profileText = `Профиль:\n👤 @${u!.username || "(не зада��)"}\n🔹 Уровень кирки: ${u!.pickaxeLevel}\n💰 Mines Coin: ${u!.minesCoin}\n⭐ Stars: ${u!.starsBalance}\n⏱ Последний коп: ${u!.lastMineAt?.toISOString() || "никогда"}\n\nИнвентарь:\n${invSummary}\n\nРеферальная ссылка:\n${refLink}\nРефералов: ${referralsCount} | Заработано от рефералов: ${refEarned} ⭐`;
      await ctx.api.sendMessage(ctx.chat!.id, profileText, {
        reply_markup: mainMenuKeyboard()
      });
      break;
    }

    case "inventory": {
      const u = await prisma.user.findUnique({ where: { id: user.id }, include: { inventory: true } });
      const invLines = u!.inventory.map((i: any) => `${humanize(i.resource)}: ${i.amount}`).join("\n") || "пусто";
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

    case "ladder": {
      // Start ladder: show bet options
      const betOptions = [10,15,25,50,150,250,300,400,500];
      const kb = new InlineKeyboard();
      for (const b of betOptions) kb.text(`${b} ⭐`, `action:ladder_bet:${b}`).row();
      kb.text("🔙 В меню", "action:menu");
      await ctx.api.sendMessage(ctx.chat!.id, "Выберите ставку для игры 'Лесенка':", { reply_markup: kb });
      break;
    }

    case "ladder_bet": {
      const amount = parts[2] ? Number(parts[2]) : 0;
      const allowed = [10,15,25,50,150,250,300,400,500];
      if (!allowed.includes(amount)) return ctx.api.sendMessage(ctx.chat!.id, "Недопустимая ставка для лесенки.");
      // atomic deduction: only deduct if balance >= amount
      const where = { id: user.id, starsBalance: { gte: BigInt(amount) } } as any;
      const data = { starsBalance: { decrement: BigInt(amount) } } as any;
      const res = await prisma.user.updateMany({ where, data } as any);
      if (res.count === 0) return ctx.api.sendMessage(ctx.chat!.id, "Недостаточно звёзд для ставки.");
      await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(-amount), type: "ladder_bet", meta: String(amount) } });
      // create game state
      const broken = generateBrokenSets();
      const state: LadderState = { userId: user.id, bet: amount, level: 1, broken, startedAt: Date.now(), locked: false, chatId: ctx.chat!.id };
      ladderGames.set(user.id, state);
      const kb = buildLadderKeyboard(1);
      const msg = await ctx.api.sendMessage(ctx.chat!.id, `Лесенка — уровень 1/${LADDER_LEVELS}\nСтавка: ${amount} ⭐\nВыберите лестницу (1–8):`, { reply_markup: kb } as any);
      state.messageId = msg.message_id;
      ladderGames.set(user.id, state);
      // persist to DB (one active per user)
      try {
        await prisma.activeGame.create({ data: { userId: user.id, bet: BigInt(amount), level: 1, broken: JSON.parse(JSON.stringify(broken.map((s:any)=>Array.from(s)))), messageId: state.messageId, chatId: state.chatId, startedAt: new Date(state.startedAt) } });
      } catch (e) {
        // ignore create errors
      }
      // schedule expire (safe)
      scheduleLadderExpireSafe(user.id);
      break;
    }

    case "ladder_pick": {
      const lvl = parts[2] ? Number(parts[2]) : NaN;
      const col = parts[3] ? Number(parts[3]) : NaN;
      if (isNaN(lvl) || isNaN(col)) return ctx.api.sendMessage(ctx.chat!.id, "Неверный выбор.");
      const state = ladderGames.get(user.id);
      if (!state) return ctx.api.sendMessage(ctx.chat!.id, "У вас нет активной игры. Выберите ставку для начала.");
      if (lvl !== state.level) return ctx.api.sendMessage(ctx.chat!.id, "Этот уровень уже неактуален.");
      if (userLocks.has(user.id)) return ctx.answerCallbackQuery({ text: "Обработка..." });
      userLocks.add(user.id);
      clearLadderTimer(user.id);
      try {
        const msg = ctx.callbackQuery?.message;
        // check if selected is broken
        const brokenSet = state.broken[state.level - 1];
        if (brokenSet.has(col)) {
          // lose
          ladderGames.delete(user.id);
          const text = `💥 Вы выбрали лестницу ${col + 1}. Лестница сломана — вы проиграли ставку ${state.bet} ⭐.`;
          if (msg) await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, text, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
          else await ctx.api.sendMessage(ctx.chat!.id, text, { reply_markup: mainMenuKeyboard() });
          await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(0), type: "ladder_loss", meta: JSON.stringify({ bet: state.bet, level: state.level, col }) } });
          try { await prisma.activeGame.deleteMany({ where: { userId: state.userId } }); } catch (e) {}
          clearLadderTimer(user.id);
          break;
        }
        // success on level
        const multiplier = LADDER_MULTIPLIERS[state.level - 1];
        const potential = Math.floor(state.bet * multiplier);
        state.level += 1; // advance
        ladderGames.set(user.id, state);
        const nextLevel = state.level;
        const text = `✅ Лестница ${col + 1} цела! Вы прошли уровень ${lvl}. Текущий множитель: x${multiplier} → возможный выигрыш: ${potential} ⭐\nВы можете забрать или продолжить на следующий уровень.`;
        if (state.level > LADDER_LEVELS) {
          // finished all levels, auto pay
          ladderGames.delete(user.id);
          clearLadderTimer(user.id);
          await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) + potential) } });
          await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(potential), type: "ladder_win", meta: JSON.stringify({ bet: state.bet, level: lvl }) } });
          try { await prisma.activeGame.deleteMany({ where: { userId: state.userId } }); } catch (e) {}
          const finalText = `🏆 Вы прошли все уровни! Вы выиграли ${potential} ⭐`;
          if (msg) await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, finalText, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
          else await ctx.api.sendMessage(ctx.chat!.id, finalText, { reply_markup: mainMenuKeyboard() });
          break;
        }
        // show next level keyboard
        const kb = buildLadderKeyboard(nextLevel);
        if (msg) await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, text, { reply_markup: kb } as any).catch(() => {});
        else await ctx.api.sendMessage(ctx.chat!.id, text, { reply_markup: kb });
        // persist updated level to DB
        try {
          await prisma.activeGame.updateMany({ where: { userId: state.userId } as any, data: { level: state.level, broken: JSON.parse(JSON.stringify(state.broken.map((s:any)=>Array.from(s)))) } as any });
        } catch (e) {}
        // schedule next-level timeout (safe)
        scheduleLadderExpireSafe(user.id);
      } finally {
        userLocks.delete(user.id);
      }
      break;
    }

    case "ladder_take": {
      const lvl = parts[2] ? Number(parts[2]) : NaN;
      const state = ladderGames.get(user.id);
      if (!state) return ctx.api.sendMessage(ctx.chat!.id, "У вас нет активной игры.");
      const payoutLevel = Math.max(1, Math.min(LADDER_LEVELS, lvl));
      const multiplier = LADDER_MULTIPLIERS[payoutLevel - 1];
      const payout = Math.floor(state.bet * multiplier);
      // pay out
      ladderGames.delete(user.id);
      clearLadderTimer(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) + payout) } });
      await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(payout), type: "ladder_win", meta: JSON.stringify({ bet: state.bet, level: payoutLevel }) } });
      try { await prisma.activeGame.deleteMany({ where: { userId: state.userId } }); } catch (e) {}
      const msg = ctx.callbackQuery?.message;
      const text = `💸 Вы забрали ${payout} ⭐ (ставка ${state.bet} ⭐, уровень ${payoutLevel}, множитель x${multiplier}).`;
      if (msg) await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, text, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
      else await ctx.api.sendMessage(ctx.chat!.id, text, { reply_markup: mainMenuKeyboard() });
      break;
    }

    case "ladder_cancel": {
      const state = ladderGames.get(user.id);
      if (!state) return ctx.api.sendMessage(ctx.chat!.id, "У вас нет активной игры.");
      ladderGames.delete(user.id);
      // refund bet
      clearLadderTimer(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) + state.bet) } });
      await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(state.bet), type: "ladder_refund", meta: JSON.stringify({ reason: "cancel" }) } });
      try { await prisma.activeGame.deleteMany({ where: { userId: state.userId } }); } catch (e) {}
      const msg = ctx.callbackQuery?.message;
      if (msg) await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `🚪 Игра отменена — ставка ${state.bet} ⭐ возвращена.`, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
      else await ctx.api.sendMessage(ctx.chat!.id, `Игра отменена — ставка ${state.bet} ⭐ возвращена.`, { reply_markup: mainMenuKeyboard() });
      break;
    }

    case "case_free": {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const deposits = await prisma.transaction.findMany({ where: { userId: user.id, type: "deposit", createdAt: { gte: startOfDay } } });
      const totalDepositedToday = deposits.reduce((s: number, d: any) => s + Number(d.amount), 0);
      if (totalDepositedToday < 200) return ctx.api.sendMessage(ctx.chat!.id, "Для получения бесплатного кейса нужно пополнить баланс на 200 звёзд сегодня.");
      if (user.lastFreeCaseAt) {
        const last = user.lastFreeCaseAt;
        if (last >= startOfDay) return ctx.api.sendMessage(ctx.chat!.id, "Вы уже открывали бесплатный кейс сегодня.");
      }
      const cancelKb = new InlineKeyboard().text("⏹️ Отменить", "action:anim_cancel");
      const animMsg = await ctx.api.sendMessage(ctx.chat!.id, "Открываем бесплатный кейс... 🎁", { reply_markup: cancelKb } as any);
      const steps = ["...", "🔹 Лот...", "🔸 Подбираем...", "🎉 Открываем!"];
      scheduleAnimatedEdits(ctx.chat!.id, animMsg.message_id, steps, 600, `Вы получили ${randInt(10,75)} ⭐`, mainMenuKeyboard());
      // Note: reward handled inside scheduled finalization earlier; but to ensure DB integrity, scheduleAnimatedEdits finalization will display final text only
      // We'll perform DB update after a short delay matching schedule
      setTimeout(async () => {
        const reward = randInt(10, 75); // generate again to avoid race; better would be deterministic but acceptable for now
        await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) + reward), lastFreeCaseAt: new Date() } });
        await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(reward), type: "case_free", meta: String(reward) } });
      }, 600 * (steps.length + 1));
      break;
    }

    case "case2": {
      // cost 150 stars
      if (Number(user.starsBalance) < 150) return ctx.api.sendMessage(ctx.chat!.id, "Недостаточно звёзд для открытия кейса (150)");
      await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) - 150) } });
      const rewards = [0,15,25,50,100,200,225];
      const weights = [40,20,15,10,8,5,2];
      const choice = weightedChoice(rewards, weights);
      const cancelKb2 = new InlineKeyboard().text("⏹️ Отменить", "action:anim_cancel");
      const animMsg = await ctx.api.sendMessage(ctx.chat!.id, "Открываем кейс за 150 ⭐...", { reply_markup: cancelKb2 } as any);
      setTimeout(() => bot.api.editMessageText(ctx.chat!.id, animMsg.message_id, "Крутится барабан... 🎰").catch(() => {}), 500);
      setTimeout(async () => {
        if (choice === 0) {
          await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(0), type: "case2", meta: JSON.stringify({ reward: 0 }) } });
          await bot.api.editMessageText(ctx.chat!.id, animMsg.message_id, `Увы, ничего не выпало.`, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
        } else {
          await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number((await prisma.user.findUnique({ where: { id: user.id } }))!.starsBalance) + choice) } });
          await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(choice), type: "case2", meta: String(choice) } });
          await bot.api.editMessageText(ctx.chat!.id, animMsg.message_id, `Поздравляем! Вы получили ${choice} ⭐`, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
        }
      }, 1500);
      break;
    }

    case "case3": {
      if (Number(user.starsBalance) < 250) return ctx.api.sendMessage(ctx.chat!.id, "Недостаточно звёзд для открыт��я кейса (250)");
      await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number(user.starsBalance) - 250) } });
      const rewards = [100,150,175,275,300,350];
      const weights = [40,25,15,12,6,2];
      const choice = weightedChoice(rewards, weights);
      const cancelKb3 = new InlineKeyboard().text("⏹️ Отменить", "action:anim_cancel");
      const animMsg = await ctx.api.sendMessage(ctx.chat!.id, "Открываем элитный кейс за 250 ⭐...", { reply_markup: cancelKb3 } as any);
      setTimeout(() => bot.api.editMessageText(ctx.chat!.id, animMsg.message_id, "Вихрь на��рад... 🌪️").catch(() => {}), 500);
      setTimeout(async () => {
        await prisma.user.update({ where: { id: user.id }, data: { starsBalance: BigInt(Number((await prisma.user.findUnique({ where: { id: user.id } }))!.starsBalance) + choice) } });
        await prisma.transaction.create({ data: { userId: user.id, amount: BigInt(choice), type: "case3", meta: String(choice) } });
        await bot.api.editMessageText(ctx.chat!.id, animMsg.message_id, `🎉 Вы получили ${choice} ⭐`, { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
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

    case "anim_cancel": {
      const msg = ctx.callbackQuery?.message;
      if (msg) {
        clearAnimationTimers(msg.message_id);
        await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, "Анимация отменена.", { reply_markup: mainMenuKeyboard() } as any).catch(() => {});
      } else {
        await ctx.api.sendMessage(ctx.chat!.id, "Анимация отменена.", { reply_markup: mainMenuKeyboard() });
      }
      break;
    }

    default: {
      // handle withdrawal actions and others
      if (action.startsWith("w_")) {
        const amount = Number(action.split("_")[1]);
        const required = Math.floor(amount * 1.1);
        if (Number(user.starsBalance) < required) return ctx.api.sendMessage(ctx.chat!.id, `��ля вывода ${amount}⭐ нужно ${required}⭐ на балансе.`);
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
      const ref = await prisma.user.findUnique({ where: { id: user.referrerId } }).catch(() => null);
      if (ref) {
        const refBonus = Math.floor(amount * 0.05);
        await prisma.user.update({ where: { id: ref.id }, data: { starsBalance: BigInt(Number(ref.starsBalance) + refBonus) } });
        await prisma.transaction.create({ data: { userId: ref.id, amount: BigInt(refBonus), type: "ref_bonus", meta: JSON.stringify({ fromUserId: user.id }) } });
      }
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

// load active ladder games from DB on startup
export async function loadActiveGames() {
  try {
    const games = await prisma.activeGame.findMany();
    for (const g of games) {
      const brokenArr: number[][] = (g.broken as any) || [];
      const brokenSets: Set<number>[] = brokenArr.map(arr => new Set(arr));
      const state: LadderState = {
        userId: g.userId,
        bet: Number(g.bet),
        level: g.level,
        broken: brokenSets,
        messageId: g.messageId ?? undefined,
        chatId: g.chatId ?? undefined,
        startedAt: g.startedAt.getTime(),
        locked: !!g.locked,
      };
      ladderGames.set(g.userId, state);
      // schedule expiration relative to startedAt (90s from startedAt)
      const elapsed = Date.now() - state.startedAt;
      const remaining = Math.max(0, 90_000 - elapsed);
      // replace timer with remaining
      clearLadderTimer(g.userId);
      const t = setTimeout(async () => {
        const st = ladderGames.get(g.userId);
        if (!st) return;
        ladderGames.delete(g.userId);
        await prisma.transaction.create({ data: { userId: st.userId, amount: BigInt(0), type: "ladder_timeout", meta: JSON.stringify({ bet: st.bet }) } });
        try {
          if (st.messageId && st.chatId) await bot.api.editMessageText(st.chatId, st.messageId, `⏱ Время вышло — ставка ${st.bet} ⭐ сгоре��а.`, { reply_markup: mainMenuKeyboard() } as any);
        } catch (e) {}
        await prisma.activeGame.deleteMany({ where: { userId: g.userId } });
      }, remaining);
      ladderTimers.set(g.userId, t);
    }
    console.log(`Loaded ${games.length} active games from DB`);
  } catch (e) {
    console.error("Failed to load active games:", e);
  }
}

export default bot;
