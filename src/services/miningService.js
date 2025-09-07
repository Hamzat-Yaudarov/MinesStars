const prisma = require('../db/prisma');

const RESOURCES = [
  {
    key: 'coal',
    label: 'Уголь',
    chance: 0.60,
    ranges: [
      [70, 400], [85, 480], [100, 560], [120, 650], [145, 750], [170, 850], [195, 960], [220, 1070], [245, 1180], [270, 1290], [300, 1400],
    ],
    price: 1,
  },
  {
    key: 'copper',
    label: 'Медь',
    chance: 0.25,
    ranges: [
      [30, 65], [36, 78], [43, 91], [52, 105], [63, 120], [76, 136], [90, 150], [105, 165], [120, 180], [135, 195], [150, 210],
    ],
    price: 3,
  },
  {
    key: 'iron',
    label: 'Железо',
    chance: 0.10,
    ranges: [
      [12, 20], [14, 24], [17, 28], [20, 33], [24, 39], [29, 46], [34, 54], [40, 62], [47, 71], [54, 80], [62, 90],
    ],
    price: 10,
  },
  {
    key: 'gold',
    label: 'Золото',
    chance: 0.0416,
    ranges: [
      [5, 7], [6, 9], [7, 11], [9, 13], [11, 16], [13, 19], [15, 22], [18, 25], [21, 29], [25, 33], [29, 38],
    ],
    price: 30,
  },
  {
    key: 'diamond',
    label: 'Алмаз',
    chance: 0.0116,
    ranges: [
      [1, 2], [1, 3], [2, 3], [2, 4], [3, 4], [3, 5], [4, 6], [4, 7], [5, 8], [6, 9], [7, 10],
    ],
    price: 100,
  },
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function performMine(user) {
  const level = Math.max(0, Math.min(10, user.pickaxeLevel || 0));
  const loot = {};
  for (const res of RESOURCES) {
    if (Math.random() < res.chance) {
      const rangeIndex = Math.min(level, res.ranges.length - 1);
      const [min, max] = res.ranges[rangeIndex];
      const amount = randInt(min, max);
      loot[res.key] = amount;
    }
  }

  // сохраняем инвентарь и транзакцию
  const now = new Date();
  for (const [key, amount] of Object.entries(loot)) {
    const existing = await prisma.inventory.findFirst({ where: { userId: BigInt(user.id), resource: key } });
    if (existing) {
      await prisma.inventory.update({ where: { id: existing.id }, data: { amount: existing.amount + amount } });
    } else {
      await prisma.inventory.create({ data: { userId: BigInt(user.id), resource: key, amount } });
    }
  }

  // обновляем время копа
  await prisma.user.update({ where: { id: BigInt(user.id) }, data: { lastMineAt: now } });

  return loot;
}

module.exports = { performMine, RESOURCES };
