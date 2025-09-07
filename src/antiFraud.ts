type UserId = string;

export class RateLimiter {
  private attempts = new Map<UserId, number[]>();
  private blocked = new Map<UserId, number>();
  private windowMs: number;
  private maxAttempts: number;
  private blockMs: number;

  constructor(maxAttempts = 10, windowMs = 10_000, blockMs = 60_000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.blockMs = blockMs;
  }

  isBlocked(userId: UserId) {
    const until = this.blocked.get(userId);
    if (!until) return false;
    if (Date.now() > until) {
      this.blocked.delete(userId);
      return false;
    }
    return true;
  }

  hit(userId: UserId) {
    if (this.isBlocked(userId)) return false;
    const now = Date.now();
    const arr = this.attempts.get(userId) || [];
    const cutoff = now - this.windowMs;
    const filtered = arr.filter(t => t > cutoff);
    filtered.push(now);
    this.attempts.set(userId, filtered);
    if (filtered.length > this.maxAttempts) {
      this.blocked.set(userId, now + this.blockMs);
      this.attempts.delete(userId);
      return false;
    }
    return true;
  }

  remaining(userId: UserId) {
    if (this.isBlocked(userId)) return 0;
    const now = Date.now();
    const arr = this.attempts.get(userId) || [];
    const cutoff = now - this.windowMs;
    const filtered = arr.filter(t => t > cutoff);
    return Math.max(0, this.maxAttempts - filtered.length);
  }
}

export default new RateLimiter(8, 10_000, 60_000);
