export type ResourceKey = "coal" | "copper" | "iron" | "gold" | "diamond";

export const RESOURCE_PRICES: Record<ResourceKey, number> = {
  coal: 1,
  copper: 3,
  iron: 10,
  gold: 30,
  diamond: 100,
};

export const BASE_CHANCES: { key: ResourceKey; pct: number }[] = [
  { key: "coal", pct: 60 },
  { key: "copper", pct: 25 },
  { key: "iron", pct: 10 },
  { key: "gold", pct: 4.16 },
  { key: "diamond", pct: 1.16 },
];

// Ranges for levels 0..10 (0 = base/no pickaxe)
export const RANGES: Record<ResourceKey, Array<[number, number]>> = {
  coal: [
    [70, 400],
    [85, 480],
    [100, 560],
    [120, 650],
    [145, 750],
    [170, 850],
    [195, 960],
    [220, 1070],
    [245, 1180],
    [270, 1290],
    [300, 1400],
  ],
  copper: [
    [30, 65],
    [36, 78],
    [43, 91],
    [52, 105],
    [63, 120],
    [76, 136],
    [90, 150],
    [105, 165],
    [120, 180],
    [135, 195],
    [150, 210],
  ],
  iron: [
    [12, 20],
    [14, 24],
    [17, 28],
    [20, 33],
    [24, 39],
    [29, 46],
    [34, 54],
    [40, 62],
    [47, 71],
    [54, 80],
    [62, 90],
  ],
  gold: [
    [5, 7],
    [6, 9],
    [7, 11],
    [9, 13],
    [11, 16],
    [13, 19],
    [15, 22],
    [18, 25],
    [21, 29],
    [25, 33],
    [29, 38],
  ],
  diamond: [
    [1, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [3, 4],
    [3, 5],
    [4, 6],
    [4, 7],
    [5, 8],
    [6, 9],
    [7, 10],
  ],
};

export const PICKAXE_COSTS = [0, 10000, 50000, 100000, 150000, 200000, 250000, 300000, 350000, 400000, 500000];

function weightedPick(): ResourceKey {
  const total = BASE_CHANCES.reduce((s, r) => s + r.pct, 0);
  const rnd = Math.random() * total;
  let acc = 0;
  for (const r of BASE_CHANCES) {
    acc += r.pct;
    if (rnd <= acc) return r.key;
  }
  return BASE_CHANCES[0].key;
}

export function performMine(pickaxeLevel: number) {
  const lvl = Math.max(0, Math.min(10, pickaxeLevel));
  const resource = weightedPick();
  const [min, max] = RANGES[resource][lvl];
  const amount = Math.floor(Math.random() * (max - min + 1)) + min;
  const coins = amount * RESOURCE_PRICES[resource];
  return { resource, amount, coins };
}
