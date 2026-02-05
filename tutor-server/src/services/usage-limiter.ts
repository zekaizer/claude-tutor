import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { UsageData } from '../types/index.js';

const HISTORY_DIR = path.join(os.homedir(), 'tutor-history');
const USAGE_FILE = path.join(HISTORY_DIR, 'usage.json');
const DAILY_LIMIT = 200;

export class UsageLimiter {
  private usage: UsageData = { date: '', count: 0 };
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(HISTORY_DIR, { recursive: true });
    await this.loadUsage();
    this.initialized = true;
    console.log('[UsageLimiter] Initialized, today:', this.usage.count, '/', DAILY_LIMIT);
  }

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private async loadUsage(): Promise<void> {
    try {
      const data = await fs.readFile(USAGE_FILE, 'utf-8');
      this.usage = JSON.parse(data);

      // Reset if it's a new day
      if (this.usage.date !== this.getTodayDate()) {
        this.usage = { date: this.getTodayDate(), count: 0 };
        await this.saveUsage();
      }
    } catch {
      // File doesn't exist, start fresh
      this.usage = { date: this.getTodayDate(), count: 0 };
      await this.saveUsage();
    }
  }

  private async saveUsage(): Promise<void> {
    await fs.writeFile(USAGE_FILE, JSON.stringify(this.usage, null, 2));
  }

  async canMakeRequest(): Promise<boolean> {
    // Ensure we're checking current day
    if (this.usage.date !== this.getTodayDate()) {
      this.usage = { date: this.getTodayDate(), count: 0 };
      await this.saveUsage();
    }

    return this.usage.count < DAILY_LIMIT;
  }

  async recordRequest(): Promise<void> {
    // Reset if new day
    if (this.usage.date !== this.getTodayDate()) {
      this.usage = { date: this.getTodayDate(), count: 0 };
    }

    this.usage.count++;
    await this.saveUsage();
    console.log('[UsageLimiter] Request recorded:', this.usage.count, '/', DAILY_LIMIT);
  }

  getRemainingRequests(): number {
    if (this.usage.date !== this.getTodayDate()) {
      return DAILY_LIMIT;
    }
    return Math.max(0, DAILY_LIMIT - this.usage.count);
  }

  getUsageInfo(): { used: number; limit: number; remaining: number } {
    const remaining = this.getRemainingRequests();
    return {
      used: this.usage.date === this.getTodayDate() ? this.usage.count : 0,
      limit: DAILY_LIMIT,
      remaining,
    };
  }
}

export const usageLimiter = new UsageLimiter();
