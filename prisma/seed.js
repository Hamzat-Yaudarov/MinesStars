const { PrismaClient } = require('@prisma/client');
const CONFIG = require('../src/config');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding pickaxe levels...');
  for (const lvl of CONFIG.pickaxeLevels) {
    const existing = await prisma.pickaxeLevel.findUnique({ where: { level: lvl.level } });
    const chanceMultiplier = lvl.chanceMultiplier || {};
    if (existing) {
      await prisma.pickaxeLevel.update({
        where: { level: lvl.level },
        data: {
          cost: lvl.cost,
          coalMin: lvl.ranges.coal[0],
          coalMax: lvl.ranges.coal[1],
          copperMin: lvl.ranges.copper[0],
          copperMax: lvl.ranges.copper[1],
          ironMin: lvl.ranges.iron[0],
          ironMax: lvl.ranges.iron[1],
          goldMin: lvl.ranges.gold[0],
          goldMax: lvl.ranges.gold[1],
          diamondMin: lvl.ranges.diamond[0],
          diamondMax: lvl.ranges.diamond[1],
          chanceMultiplier,
        },
      });
    } else {
      await prisma.pickaxeLevel.create({
        data: {
          level: lvl.level,
          cost: lvl.cost,
          coalMin: lvl.ranges.coal[0],
          coalMax: lvl.ranges.coal[1],
          copperMin: lvl.ranges.copper[0],
          copperMax: lvl.ranges.copper[1],
          ironMin: lvl.ranges.iron[0],
          ironMax: lvl.ranges.iron[1],
          goldMin: lvl.ranges.gold[0],
          goldMax: lvl.ranges.gold[1],
          diamondMin: lvl.ranges.diamond[0],
          diamondMax: lvl.ranges.diamond[1],
          chanceMultiplier,
        },
      });
    }
  }

  console.log('Seeding cases...');
  for (const c of CONFIG.cases) {
    await prisma.case.upsert({
      where: { externalId: c.id },
      update: { name: c.name, costStars: c.costStars, meta: { rewards: c.rewards, requirement: c.requirement || null } },
      create: { externalId: c.id, name: c.name, costStars: c.costStars, meta: { rewards: c.rewards, requirement: c.requirement || null } },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
