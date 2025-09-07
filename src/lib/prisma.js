const { PrismaClient } = require('@prisma/client');

// Create a single shared Prisma client instance across the app to avoid exhausting connections.
const prisma = global.__prisma || new PrismaClient();
if (!global.__prisma) global.__prisma = prisma;

module.exports = prisma;
