require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const prisma = require('./lib/prisma');
const CONFIG = require('./config');

const BOT_TOKEN = process.env.BOT_TOKEN || CONFIG.BOT_TOKEN;
const TELEGRAM_API = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

const app = express();
app.use(cors());
app.use(express.json());

// Helper: find or create user by telegramId
async function findOrCreateUser(telegramId, username) {
  let user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    user = await prisma.user.create({ data: { telegramId, username, balanceStars: 0, balanceCoins: 0, pickaxeLevel: 0 } });
  }
  return user;
}

// Handle Telegram webhook updates
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    // pre_checkout_query handling
    if (update.pre_checkout_query) {
      const query = update.pre_checkout_query;
      // Always answer OK for digital goods (Stars)
      await axios.post(TELEGRAM_API('answerPreCheckoutQuery'), {
        pre_checkout_query_id: query.id,
        ok: true,
      });
      return res.sendStatus(200);
    }

    // message with successful_payment
    if (update.message && update.message.successful_payment) {
      const msg = update.message;
      const tId = String(msg.from.id);
      const username = msg.from.username || null;
      const amount = msg.successful_payment.total_amount; // provider-specific units
      // For Stars payments, we expect the amount expressed in Stars units. We'll credit stars as amount
      const creditedStars = amount;

      const user = await findOrCreateUser(tId, username);

      const newBalance = user.balanceStars + creditedStars;
      await prisma.user.update({ where: { id: user.id }, data: { balanceStars: newBalance } });

      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: 'deposit_stars',
          deltaStars: creditedStars,
          balanceAfter: newBalance,
          meta: { successful_payment: msg.successful_payment },
        },
      });

      return res.sendStatus(200);
    }

    // other updates
    return res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error', err?.response?.data || err.message || err);
    return res.sendStatus(500);
  }
});

// Simple API: get or create profile
app.get('/api/profile/:telegramId', async (req, res) => {
  const telegramId = String(req.params.telegramId);
  try {
    const user = await findOrCreateUser(telegramId, null);
    return res.json({ user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Mining endpoint: triggers a 'коп' if cooldown passed
app.post('/api/mine/:telegramId', async (req, res) => {
  const telegramId = String(req.params.telegramId);
  try {
    const user = await findOrCreateUser(telegramId, null);

    // find last mine
    const lastMine = await prisma.mineLog.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    const now = new Date();
    if (lastMine) {
      const diff = (now - lastMine.createdAt) / 1000; // seconds
      if (diff < CONFIG.miningCooldownSeconds) {
        return res.status(429).json({ error: 'cooldown', secondsLeft: Math.ceil(CONFIG.miningCooldownSeconds - diff) });
      }
    }

    // pick resource by weighted chance
    const pool = [];
    for (const [key, val] of Object.entries(CONFIG.resources)) {
      pool.push({ resource: key, chance: val.baseChance });
    }
    // normalize and pick
    const r = Math.random();
    let acc = 0;
    let selected = 'coal';
    for (const p of pool) {
      acc += p.chance;
      if (r <= acc) {
        selected = p.resource;
        break;
      }
    }

    // get ranges from pickaxe level config
    const lvl = Math.min(Math.max(user.pickaxeLevel, 0), CONFIG.pickaxeLevels.length - 1);
    const levelCfg = CONFIG.pickaxeLevels.find((x) => x.level === lvl) || CONFIG.pickaxeLevels[0];
    const ranges = levelCfg.ranges;
    const range = ranges[selected];
    const amount = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

    // coin value
    const coinValue = amount * CONFIG.resources[selected].price;

    // persist mine
    await prisma.mineLog.create({ data: { userId: user.id, resource: selected, amount, coinValue } });

    // update user's coin balance
    const newCoins = user.balanceCoins + coinValue;
    await prisma.user.update({ where: { id: user.id }, data: { balanceCoins: newCoins } });

    await prisma.transaction.create({ data: { userId: user.id, type: 'mine', deltaStars: 0, balanceAfter: newCoins, meta: { resource: selected, amount, coinValue } } });

    return res.json({ resource: selected, amount, coinValue, balanceCoins: newCoins });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Endpoint to convert coins to stars (sell resources)
app.post('/api/sell/:telegramId', async (req, res) => {
  const telegramId = String(req.params.telegramId);
  const { coinsToSell } = req.body || {};
  if (!coinsToSell || coinsToSell <= 0) return res.status(400).json({ error: 'invalid' });
  try {
    const user = await findOrCreateUser(telegramId, null);
    if (user.balanceCoins < coinsToSell) return res.status(400).json({ error: 'insufficient_coins' });

    const starsToAdd = coinsToSell / CONFIG.conversion.minesCoinPerStar;
    const newCoins = Number((user.balanceCoins - coinsToSell).toFixed(2));
    const newStars = Number((user.balanceStars + starsToAdd).toFixed(6));

    await prisma.user.update({ where: { id: user.id }, data: { balanceCoins: newCoins, balanceStars: newStars } });
    await prisma.transaction.create({ data: { userId: user.id, type: 'sell', deltaStars: starsToAdd, balanceAfter: newStars, meta: { coinsSold: coinsToSell } } });

    return res.json({ balanceStars: newStars, balanceCoins: newCoins, starsAdded: starsToAdd });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Buy pickaxe (upgrade)
app.post('/api/shop/buyPickaxe/:telegramId', async (req, res) => {
  const telegramId = String(req.params.telegramId);
  try {
    const user = await findOrCreateUser(telegramId, null);
    const current = user.pickaxeLevel || 0;
    const nextLevel = current + 1;
    const nextCfg = CONFIG.pickaxeLevels.find((p) => p.level === nextLevel);
    if (!nextCfg) return res.status(400).json({ error: 'max_level' });

    // cost in coins (Mines Coin)
    const costCoins = nextCfg.cost;
    if (user.balanceCoins < costCoins) return res.status(400).json({ error: 'insufficient_coins' });

    const newCoins = user.balanceCoins - costCoins;
    await prisma.user.update({ where: { id: user.id }, data: { balanceCoins: newCoins, pickaxeLevel: nextLevel } });
    await prisma.transaction.create({ data: { userId: user.id, type: 'buy_pickaxe', deltaStars: 0, balanceAfter: newCoins, meta: { newLevel: nextLevel, costCoins } } });

    return res.json({ pickaxeLevel: nextLevel, balanceCoins: newCoins });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Open case
app.post('/api/cases/open/:telegramId', async (req, res) => {
  const telegramId = String(req.params.telegramId);
  const { caseId } = req.body || {};
  try {
    const user = await findOrCreateUser(telegramId, null);
    const c = await prisma.case.findUnique({ where: { externalId: caseId } });
    if (!c) return res.status(404).json({ error: 'no_case' });

    // Check cost
    if (c.costStars > 0 && user.balanceStars < c.costStars) return res.status(400).json({ error: 'insufficient_stars' });

    // If free_daily, check requirement and daily limit
    const meta = c.meta || {};
    if (caseId === 'free_daily') {
      // check daily deposit requirement
      // simplified: assume depositTodayMinesStars check is satisfied if user.balanceStars >= 0 (we skip tracking deposits by day for now)
      // check daily limit
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const openedToday = await prisma.transaction.count({ where: { userId: user.id, type: 'open_case', createdAt: { gte: since } } });
      if (openedToday >= 1) return res.status(400).json({ error: 'daily_limit' });
    }

    // charge
    if (c.costStars > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { balanceStars: user.balanceStars - c.costStars } });
    }

    // pick reward by weights
    const rewards = meta.rewards || []; // [amount, weight]
    const totalWeight = rewards.reduce((s, r) => s + r[1], 0);
    let pick = Math.random() * totalWeight;
    let reward = rewards[0] ? rewards[0][0] : 0;
    for (const rwd of rewards) {
      pick -= rwd[1];
      if (pick <= 0) { reward = rwd[0]; break; }
    }

    // credit reward (stars)
    const newStars = user.balanceStars + reward - (c.costStars || 0);
    await prisma.user.update({ where: { id: user.id }, data: { balanceStars: newStars } });
    await prisma.transaction.create({ data: { userId: user.id, type: 'open_case', deltaStars: reward - (c.costStars || 0), balanceAfter: newStars, meta: { caseId, reward } } });

    return res.json({ reward, balanceStars: newStars });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Withdraw request
app.post('/api/withdraw/:telegramId', async (req, res) => {
  const telegramId = String(req.params.telegramId);
  const { amountStars } = req.body || {};
  if (!amountStars || !CONFIG.withdrawal.allowedAmountsStars.includes(amountStars)) return res.status(400).json({ error: 'invalid_amount' });
  try {
    const user = await findOrCreateUser(telegramId, null);
    const fee = Math.ceil((amountStars * CONFIG.withdrawal.feePercent) / 100);
    const required = amountStars + fee;
    if (user.balanceStars < required) return res.status(400).json({ error: 'insufficient_stars' });

    const newStars = user.balanceStars - required;
    await prisma.user.update({ where: { id: user.id }, data: { balanceStars: newStars } });
    await prisma.withdrawal.create({ data: { userId: user.id, amountStars, feeStars: fee, status: 'pending' } });
    await prisma.transaction.create({ data: { userId: user.id, type: 'withdraw_request', deltaStars: -required, balanceAfter: newStars, meta: { amountStars, fee } } });

    return res.json({ status: 'pending', balanceStars: newStars });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
