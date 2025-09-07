import dotenv from "dotenv";
dotenv.config();

export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_URL || "";
export const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
export const ADMIN_ID = process.env.ADMIN_ID || "";
export const PORT = Number(process.env.PORT || 3000);
