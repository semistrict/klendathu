import { createHash } from 'crypto';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { mkdirSync } from 'fs';
import { TRACE } from 'klendathu-utils/logging';

function findProjectRoot(): string {
  let current = process.cwd();
  while (current !== '/') {
    // Prefer .klendathu as project marker
    if (existsSync(join(current, '.klendathu'))) {
      return current;
    }
    // Fall back to .git
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    current = join(current, '..');
  }
  // No .klendathu or .git found, use cwd
  return process.cwd();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .substring(0, 50)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getCacheKey(prompt: string, schema: any): string {
  const combined = `${prompt}:::${JSON.stringify(schema)}`;
  const hash = createHash('sha256').update(combined).digest('hex');
  const slug = slugify(prompt);
  return `${slug}_${hash}`;
}

export function getCachePath(cacheKey: string): string {
  const cacheDir = process.env.KLENDATHU_CACHE || join(findProjectRoot(), '.klendathu', 'cache');
  return join(cacheDir, `${cacheKey}.json`);
}

export function loadCachedTranscript(cachePath: string): any | null {
  try {
    if (!existsSync(cachePath)) {
      return null;
    }
    const content = readFileSync(cachePath, 'utf-8');
    const transcript = JSON.parse(content);

    // Only return transcripts marked as successful
    if (!transcript.success) {
      TRACE`Skipping cached transcript (marked as failed): ${cachePath}`;
      return null;
    }

    TRACE`Loaded cached transcript from ${cachePath}`;
    return transcript;
  } catch (err) {
    TRACE`Failed to load cached transcript: ${err}`;
    return null;
  }
}

export function saveCachedTranscript(cachePath: string, transcript: any): void {
  try {
    const cacheDir = process.env.KLENDATHU_CACHE || join(findProjectRoot(), '.klendathu', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(transcript, null, 2));
    TRACE`Saved transcript to cache: ${cachePath}`;
  } catch (err) {
    TRACE`Failed to save cached transcript: ${err}`;
  }
}
