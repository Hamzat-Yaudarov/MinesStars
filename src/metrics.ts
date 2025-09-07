import prisma from "./db";

export async function getAdminStats() {
  // sums and counts
  const totalDepositsAgg = await prisma.transaction.aggregate({ where: { type: "deposit" }, _sum: { amount: true }, _count: { id: true } });
  const totalBetsAgg = await prisma.transaction.aggregate({ where: { type: "ladder_bet" }, _sum: { amount: true }, _count: { id: true } });
  const totalWinsAgg = await prisma.transaction.aggregate({ where: { type: "ladder_win" }, _sum: { amount: true }, _count: { id: true } });
  const totalLosses = await prisma.transaction.count({ where: { type: "ladder_loss" } });
  const activeGames = await prisma.activeGame.count();
  const pendingWithdrawals = await prisma.withdrawalRequest.count({ where: { status: "pending" } });
  const totalStarsInBalancesAgg = await prisma.user.aggregate({ _sum: { starsBalance: true } });

  return {
    deposits: { total: Number(totalDepositsAgg._sum.amount ?? 0), count: totalDepositsAgg._count.id },
    bets: { total: Number(totalBetsAgg._sum.amount ?? 0), count: totalBetsAgg._count.id },
    wins: { total: Number(totalWinsAgg._sum.amount ?? 0), count: totalWinsAgg._count.id },
    losses: totalLosses,
    activeGames,
    pendingWithdrawals,
    totalStarsInBalances: Number(totalStarsInBalancesAgg._sum.starsBalance ?? 0),
  };
}

export async function listTransactions(limit = 100) {
  const tx = await prisma.transaction.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return tx;
}
