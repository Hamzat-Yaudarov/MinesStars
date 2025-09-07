const CONFIG = {
  // Secrets come from environment variables set in the deployment (BOT_TOKEN, NEON_URL, WEBHOOK_URL, ADMIN_ID)
  BOT_TOKEN: process.env.BOT_TOKEN,
  NEON_URL: process.env.NEON_URL,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  ADMIN_ID: process.env.ADMIN_ID,

  // Currency conversion
  // 200 Mines Coin = 1 STARS
  conversion: {
    minesCoinPerStar: 200,
  },

  // Resource base prices in Mines Coin
  resources: {
    coal: { price: 1, baseChance: 0.6, baseRange: [70, 400] },
    copper: { price: 3, baseChance: 0.25, baseRange: [30, 65] },
    iron: { price: 10, baseChance: 0.10, baseRange: [12, 20] },
    gold: { price: 30, baseChance: 0.0416, baseRange: [5, 7] },
    diamond: { price: 100, baseChance: 0.0116, baseRange: [1, 2] },
  },

  // Pickaxe levels: an array of level objects. Each level defines the cost (in Mines Coin),
  // and min/max ranges for possible resource drop quantities. These numbers are seeded
  // to the database at setup and can be edited later in the admin UI or directly in DB.
  // The table below covers levels 0..10. Level 0 is the free starter pickaxe (cost 0 to 'have'),
  // purchasing the first real pickaxe can be represented via shop logic.
  pickaxeLevels: [
    {
      level: 0,
      cost: 0,
      ranges: {
        coal: [70, 400],
        copper: [30, 65],
        iron: [12, 20],
        gold: [5, 7],
        diamond: [1, 2],
      },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 1,
      cost: 10000,
      ranges: { coal: [85, 480], copper: [36, 78], iron: [14, 24], gold: [6, 9], diamond: [1, 3] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 2,
      cost: 50000,
      ranges: { coal: [100, 560], copper: [43, 91], iron: [17, 28], gold: [7, 11], diamond: [2, 3] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 3,
      cost: 100000,
      ranges: { coal: [120, 650], copper: [52, 105], iron: [20, 33], gold: [9, 13], diamond: [2, 4] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 4,
      cost: 150000,
      ranges: { coal: [145, 750], copper: [63, 120], iron: [24, 39], gold: [11, 16], diamond: [3, 4] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 5,
      cost: 200000,
      ranges: { coal: [170, 850], copper: [76, 136], iron: [29, 46], gold: [13, 19], diamond: [3, 5] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 6,
      cost: 250000,
      ranges: { coal: [195, 960], copper: [90, 150], iron: [34, 54], gold: [15, 22], diamond: [4, 6] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 7,
      cost: 300000,
      ranges: { coal: [220, 1070], copper: [105, 165], iron: [40, 62], gold: [18, 25], diamond: [4, 7] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 8,
      cost: 350000,
      ranges: { coal: [245, 1180], copper: [120, 180], iron: [47, 71], gold: [21, 29], diamond: [5, 8] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 9,
      cost: 400000,
      ranges: { coal: [270, 1290], copper: [135, 195], iron: [54, 80], gold: [25, 33], diamond: [6, 9] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
    {
      level: 10,
      cost: 500000,
      ranges: { coal: [300, 1400], copper: [150, 210], iron: [62, 90], gold: [29, 38], diamond: [7, 10] },
      chanceMultiplier: { coal: 1.0, copper: 1.0, iron: 1.0, gold: 1.0, diamond: 1.0 },
    },
  ],

  // Cases definitions (seeded): name, cost (in stars), possible rewards array with weight
  cases: [
    {
      id: 'free_daily',
      name: 'Бесплатный (дневной)',
      costStars: 0,
      requirement: { depositTodayMinesStars: 200 },
      // rewards given as [amountInStars, weight]
      rewards: [
        [10, 40],
        [15, 30],
        [25, 15],
        [50, 10],
        [75, 5],
      ],
      dailyLimit: 1,
    },
    {
      id: 'case_150',
      name: 'Кейс за 150 звёзд',
      costStars: 150,
      rewards: [
        [0, 40],
        [15, 25],
        [25, 15],
        [50, 12],
        [100, 6],
        [200, 2],
        [225, 0.5],
      ],
    },
    {
      id: 'case_250',
      name: 'Кейс за 250 звёзд',
      costStars: 250,
      rewards: [
        [100, 30],
        [150, 25],
        [175, 20],
        [275, 15],
        [300, 8],
        [350, 2],
      ],
    },
  ],

  // Withdrawal fee (10%): to withdraw N stars, user must have N + fee on balance
  withdrawal: {
    feePercent: 10,
    allowedAmountsStars: [100, 250, 500, 1000, 2500, 10000],
  },

  // Referral reward percent of deposits
  referral: { percent: 5 },

  // Mining cooldown in seconds (3 hours)
  miningCooldownSeconds: 3 * 60 * 60,
};

module.exports = CONFIG;
