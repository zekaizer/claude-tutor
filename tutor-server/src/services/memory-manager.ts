import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { UserMemory, MemoryUpdate } from '../types/index.js';

const HISTORY_DIR = path.join(os.homedir(), 'tutor-history');
const MEMORY_FILE = path.join(HISTORY_DIR, 'user-memory.json');
const CURRENT_VERSION = 2;

// Compaction thresholds (flexible, not hard limits)
const COMPACTION_KEY_THRESHOLD = 20; // Suggest compaction when keys exceed this
const COMPACTION_VALUE_THRESHOLD = 50; // Or when total values exceed this

// Regex pattern to extract memory markers from Claude responses
const MEMORY_PATTERN = /\[MEMORY:(\w+)=([^\]]+)\]/g;

export class MemoryManager {
  private memory: UserMemory = this.createEmptyMemory();
  private initialized = false;

  private createEmptyMemory(): UserMemory {
    return {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: CURRENT_VERSION,
      data: {},
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(HISTORY_DIR, { recursive: true });
    await this.loadMemory();
    this.initialized = true;
    console.log('[MemoryManager] Initialized');
  }

  private async loadMemory(): Promise<void> {
    try {
      const fileData = await fs.readFile(MEMORY_FILE, 'utf-8');
      const loaded = JSON.parse(fileData) as UserMemory;

      // Handle version migration
      if (loaded.version !== CURRENT_VERSION) {
        console.log('[MemoryManager] Migrating memory from version', loaded.version);
        this.memory = this.migrateMemory(loaded);
        await this.saveMemory();
        return;
      }

      this.memory = loaded;
      console.log('[MemoryManager] Loaded existing memory');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        console.log('[MemoryManager] No existing memory, starting fresh');
      } else {
        console.error('[MemoryManager] Corrupted memory file, resetting');
      }
      this.memory = this.createEmptyMemory();
    }
  }

  // Migrate from old schema (v1) to new simple k-v (v2)
  private migrateMemory(old: unknown): UserMemory {
    const newMemory = this.createEmptyMemory();

    // Try to extract data from old format
    const oldData = old as {
      profile?: { name?: string; grade?: number };
      interests?: { hobbies?: string[] };
      learning?: { strengths?: string[]; struggles?: string[] };
    };

    if (oldData.profile?.name) {
      newMemory.data['name'] = oldData.profile.name;
    }
    if (oldData.profile?.grade) {
      newMemory.data['grade'] = String(oldData.profile.grade);
    }
    if (oldData.interests?.hobbies?.length) {
      newMemory.data['hobby'] = oldData.interests.hobbies;
    }
    if (oldData.learning?.strengths?.length) {
      newMemory.data['strength'] = oldData.learning.strengths;
    }
    if (oldData.learning?.struggles?.length) {
      newMemory.data['struggle'] = oldData.learning.struggles;
    }

    return newMemory;
  }

  private async saveMemory(): Promise<void> {
    this.memory.updatedAt = new Date().toISOString();
    await fs.writeFile(MEMORY_FILE, JSON.stringify(this.memory, null, 2));
  }

  /**
   * Extract memory markers from Claude's response
   */
  extractMemoryFromResponse(text: string): MemoryUpdate[] {
    const updates: MemoryUpdate[] = [];
    let match;

    MEMORY_PATTERN.lastIndex = 0;

    while ((match = MEMORY_PATTERN.exec(text)) !== null) {
      updates.push({
        key: match[1],
        value: match[2].trim(),
      });
    }

    return updates;
  }

  /**
   * Remove memory markers from text before displaying to user
   */
  stripMemoryMarkers(text: string): string {
    return text
      .replace(/\[MEMORY:\w+=[^\]]+\]\n?/g, '')
      .replace(/\[MEMORY_COMPACT:[\s\S]*?\]\n?/g, '')
      .trim();
  }

  /**
   * Extract and apply compaction from response if present
   * Returns true if compaction was applied
   */
  async extractAndApplyCompaction(text: string): Promise<boolean> {
    // Match multiline JSON in MEMORY_COMPACT tag
    const compactMatch = text.match(/\[MEMORY_COMPACT:([\s\S]*?)\]/);
    if (!compactMatch) {
      return false;
    }

    // Clean up the JSON (remove newlines and extra spaces)
    const jsonStr = compactMatch[1].trim();
    console.log('[MemoryManager] Found compaction in response:', jsonStr.substring(0, 100));
    return await this.applyCompactedMemory(jsonStr);
  }

  /**
   * Apply memory updates - simple k-v storage
   * Single values stay as string, multiple values become array
   */
  async applyMemoryUpdates(updates: MemoryUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    for (const update of updates) {
      const { key, value } = update;
      const existing = this.memory.data[key];

      if (!existing) {
        // New key - store as string
        this.memory.data[key] = value;
        console.log(`[MemoryManager] Saved ${key}:`, value);
      } else if (typeof existing === 'string') {
        if (existing === value) {
          // Same value - skip
          console.log(`[MemoryManager] Skipped duplicate ${key}:`, value);
        } else {
          // Different value - convert to array
          this.memory.data[key] = [existing, value];
          console.log(`[MemoryManager] Added to ${key}:`, value);
        }
      } else {
        // Already an array - add if not duplicate
        if (!existing.includes(value)) {
          existing.push(value);
          console.log(`[MemoryManager] Added to ${key}:`, value);
        } else {
          console.log(`[MemoryManager] Skipped duplicate ${key}:`, value);
        }
      }
    }

    await this.saveMemory();
  }

  /**
   * Check if memory needs compaction
   */
  needsCompaction(): boolean {
    const keyCount = Object.keys(this.memory.data).length;
    const valueCount = this.getTotalValueCount();

    const needs = keyCount > COMPACTION_KEY_THRESHOLD || valueCount > COMPACTION_VALUE_THRESHOLD;

    if (needs) {
      console.log(`[MemoryManager] Compaction suggested: ${keyCount} keys, ${valueCount} values`);
    }

    return needs;
  }

  /**
   * Get total count of all values
   */
  private getTotalValueCount(): number {
    let count = 0;
    for (const value of Object.values(this.memory.data)) {
      count += Array.isArray(value) ? value.length : 1;
    }
    return count;
  }

  /**
   * Get memory stats
   */
  getStats(): { keyCount: number; valueCount: number; needsCompaction: boolean } {
    return {
      keyCount: Object.keys(this.memory.data).length,
      valueCount: this.getTotalValueCount(),
      needsCompaction: this.needsCompaction(),
    };
  }

  /**
   * Build compaction prompt for Claude
   */
  buildCompactionPrompt(): string {
    const memoryJson = JSON.stringify(this.memory.data, null, 2);

    return `다음은 학생에 대해 기억하고 있는 정보입니다. 중복되거나 유사한 항목을 정리해주세요.

현재 메모리:
${memoryJson}

규칙:
1. 같은 의미의 키는 하나로 합쳐주세요 (예: name, student_name → name)
2. 중복된 값은 제거해주세요
3. 핵심 정보만 유지하세요
4. 결과는 반드시 아래 JSON 형식으로만 출력하세요:

{"name": "값", "grade": "값", "hobby": ["값1", "값2"], ...}

JSON만 출력하고 다른 설명은 하지 마세요.`;
  }

  /**
   * Apply compacted memory from Claude
   */
  async applyCompactedMemory(jsonString: string): Promise<boolean> {
    try {
      // Extract JSON from response (in case Claude adds extra text)
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[MemoryManager] No valid JSON found in compaction response');
        return false;
      }

      const compacted = JSON.parse(jsonMatch[0]) as Record<string, string | string[]>;

      // Validate - should have at least some data
      if (Object.keys(compacted).length === 0) {
        console.error('[MemoryManager] Compacted memory is empty, keeping original');
        return false;
      }

      // Replace memory data
      this.memory.data = compacted;
      await this.saveMemory();

      console.log('[MemoryManager] Compaction applied:', Object.keys(compacted).length, 'keys');
      return true;
    } catch (error) {
      console.error('[MemoryManager] Failed to apply compaction:', error);
      return false;
    }
  }

  /**
   * Generate memory context section for system prompt
   * If memory needs compaction, includes instruction for Claude to compact it
   */
  getMemoryPromptSection(): string {
    const entries = Object.entries(this.memory.data);

    if (entries.length === 0) {
      return '학생에 대해 아직 알려진 정보가 없습니다. 대화하면서 자연스럽게 알아가세요.';
    }

    const lines: string[] = ['현재 알고 있는 학생 정보:'];

    for (const [key, value] of entries) {
      const displayValue = Array.isArray(value) ? value.join(', ') : value;
      lines.push(`- ${key}: ${displayValue}`);
    }

    lines.push('\n이 정보를 자연스럽게 활용해서 예시를 들어주세요.');
    lines.push('(정보를 어떻게 알게 됐는지 설명하지 말고, 그냥 예전부터 알던 것처럼 자연스럽게)');

    // If compaction needed, ask Claude to compact during this response
    if (this.needsCompaction()) {
      lines.push('\n⚠️ 메모리 정리 필요: 위 정보에 중복이나 유사한 키가 있습니다.');
      lines.push('이번 응답 맨 끝에 정리된 메모리를 아래 형식으로 출력하세요:');
      lines.push('[MEMORY_COMPACT:{"name":"값","grade":"값","hobby":["값1","값2"]}]');
      lines.push('- 같은 의미의 키는 하나로 합치세요 (name, student_name → name)');
      lines.push('- 중복 값은 제거하세요');
      lines.push('- JSON만 출력, 설명 없이');
    }

    return lines.join('\n');
  }

  /**
   * Get current memory state (for API)
   */
  getMemory(): UserMemory {
    return { ...this.memory };
  }

  /**
   * Get summary of memory (for API)
   */
  getMemorySummary(): {
    hasMemory: boolean;
    data: Record<string, string | string[]>;
    stats: { keyCount: number; valueCount: number; needsCompaction: boolean };
  } {
    return {
      hasMemory: Object.keys(this.memory.data).length > 0,
      data: { ...this.memory.data },
      stats: this.getStats(),
    };
  }

  /**
   * Clear all memory (parental control)
   */
  async clearMemory(): Promise<void> {
    this.memory = this.createEmptyMemory();
    await this.saveMemory();
    console.log('[MemoryManager] Memory cleared');
  }

  /**
   * Update memory manually (parental control)
   */
  async updateMemory(updates: Record<string, string | string[]>): Promise<void> {
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined) {
        delete this.memory.data[key];
      } else {
        this.memory.data[key] = value;
      }
    }
    await this.saveMemory();
    console.log('[MemoryManager] Memory updated manually');
  }

  /**
   * Delete specific key (parental control)
   */
  async deleteKey(key: string): Promise<void> {
    delete this.memory.data[key];
    await this.saveMemory();
    console.log('[MemoryManager] Deleted key:', key);
  }
}

export const memoryManager = new MemoryManager();
