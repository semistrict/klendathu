import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Context files to search for in directory hierarchy
 * AGENTS.md is the emerging standard, CLAUDE.md for backward compatibility
 */
const CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md'];

/**
 * Result of loading context files from directory hierarchy
 */
export interface ProjectContext {
  /**
   * Combined content from all context files found
   */
  content: string;

  /**
   * Paths of files that were found and loaded
   */
  filesFound: string[];
}

/**
 * Load AGENTS.md and CLAUDE.md files from the directory hierarchy.
 * Searches from the given directory up to the root, collecting all context files.
 *
 * @param startDir - Directory to start searching from (typically where the error occurred)
 * @returns Combined context from all files found
 */
export async function loadProjectContext(startDir: string): Promise<ProjectContext> {
  const filesFound: string[] = [];
  const contents: string[] = [];

  let currentDir = startDir;
  const visited = new Set<string>();

  // Walk up the directory tree
  while (true) {
    // Prevent infinite loops from symlinks
    if (visited.has(currentDir)) {
      break;
    }
    visited.add(currentDir);

    // Try to read each context file in this directory
    for (const filename of CONTEXT_FILES) {
      const filePath = join(currentDir, filename);
      try {
        const content = await readFile(filePath, 'utf-8');
        filesFound.push(filePath);
        contents.push(`# Context from ${filePath}\n\n${content}`);
      } catch {
        // File doesn't exist, skip
      }
    }

    // Move to parent directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root
      break;
    }
    currentDir = parentDir;
  }

  return {
    content: contents.join('\n\n---\n\n'),
    filesFound,
  };
}

/**
 * Extract the directory where an error occurred from its stack trace.
 * Falls back to process.cwd() if unable to determine.
 */
export function getErrorDirectory(error: Error): string {
  if (!error.stack) {
    return process.cwd();
  }

  // Parse stack trace to find first frame with a file path
  const stackLines = error.stack.split('\n');
  for (const line of stackLines) {
    // Look for patterns like "at /path/to/file.ts:123:45" or "(/path/to/file.ts:123:45)"
    const match = line.match(/\(([^:)]+):\d+:\d+\)/) || line.match(/at ([^:]+):\d+:\d+/);
    if (match) {
      const filePath = match[1];
      // Skip node_modules and internal Node.js paths
      if (!filePath.includes('node_modules') && !filePath.startsWith('node:')) {
        try {
          // Handle file:// URLs
          const actualPath = filePath.startsWith('file://')
            ? fileURLToPath(filePath)
            : filePath;
          return dirname(actualPath);
        } catch {
          // Invalid path, continue
        }
      }
    }
  }

  return process.cwd();
}
