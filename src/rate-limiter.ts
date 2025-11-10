/**
 * Token bucket rate limiter for HubSpot API
 * Respects both burst (100-250/10sec) and daily limits
 */

import { RateLimitStatus } from './types.js';
import { logger } from './logger.js';

export class RateLimiter {
  private dailyLimit: number = 500000; // Default, will be updated from headers
  private burstLimit: number = 100; // Default, will be updated from headers
  private dailyRemaining: number;
  private burstRemaining: number;
  private safetyMargin: number;
  private lastBurstReset: number;
  private burstWindowMs: number = 10000; // 10 seconds

  constructor(safetyMargin: number = 0.1) {
    this.safetyMargin = safetyMargin;
    this.dailyRemaining = this.dailyLimit;
    this.burstRemaining = this.burstLimit;
    this.lastBurstReset = Date.now();
  }

  /**
   * Update rate limits from HubSpot response headers
   */
  updateFromHeaders(headers: Headers) {
    const dailyRemaining = headers.get('X-HubSpot-RateLimit-Daily-Remaining');
    const burstRemaining = headers.get('X-HubSpot-RateLimit-Remaining');

    if (dailyRemaining) {
      this.dailyRemaining = parseInt(dailyRemaining, 10);
      logger.debug('Updated daily rate limit', { dailyRemaining: this.dailyRemaining });
    }

    if (burstRemaining) {
      this.burstRemaining = parseInt(burstRemaining, 10);
      logger.debug('Updated burst rate limit', { burstRemaining: this.burstRemaining });
    }
  }

  /**
   * Check if we can make a request within rate limits
   */
  canMakeRequest(): boolean {
    this.resetBurstIfNeeded();

    const dailySafeThreshold = Math.floor(this.dailyLimit * this.safetyMargin);
    const burstSafeThreshold = Math.floor(this.burstLimit * this.safetyMargin);

    if (this.dailyRemaining <= dailySafeThreshold) {
      logger.warn('Approaching daily rate limit', {
        remaining: this.dailyRemaining,
        threshold: dailySafeThreshold
      });
      return false;
    }

    if (this.burstRemaining <= burstSafeThreshold) {
      logger.warn('Approaching burst rate limit', {
        remaining: this.burstRemaining,
        threshold: burstSafeThreshold
      });
      return false;
    }

    return true;
  }

  /**
   * Record a request being made
   */
  recordRequest() {
    this.resetBurstIfNeeded();
    this.dailyRemaining = Math.max(0, this.dailyRemaining - 1);
    this.burstRemaining = Math.max(0, this.burstRemaining - 1);
  }

  /**
   * Reset burst counter if window has passed
   */
  private resetBurstIfNeeded() {
    const now = Date.now();
    if (now - this.lastBurstReset >= this.burstWindowMs) {
      this.burstRemaining = this.burstLimit;
      this.lastBurstReset = now;
      logger.debug('Burst window reset');
    }
  }

  /**
   * Get current rate limit status
   */
  getStatus(): RateLimitStatus {
    this.resetBurstIfNeeded();

    return {
      dailyRemaining: this.dailyRemaining,
      burstRemaining: this.burstRemaining,
      dailyPercentUsed: ((this.dailyLimit - this.dailyRemaining) / this.dailyLimit) * 100,
      burstPercentUsed: ((this.burstLimit - this.burstRemaining) / this.burstLimit) * 100
    };
  }

  /**
   * Calculate delay for exponential backoff with jitter
   */
  calculateBackoff(attempt: number, baseDelayMs: number = 2000): number {
    const exponentialDelay = Math.pow(2, attempt) * baseDelayMs;
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return exponentialDelay + jitter;
  }
}
