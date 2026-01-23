/**
 * Log Tailing Utilities
 *
 * PURE LIB: No config access, no manager imports.
 * JSON log processing uses injected processor for summarization/filtering.
 */
import fs from 'fs';

// =============================================================================
// Types
// =============================================================================

export interface LogTailOptions {
  events?: boolean;      // Use jsonlog instead of raw log
  raw?: boolean;         // With events: output raw JSON lines (no summarizing)
  lines?: number;        // Number of recent lines to show
}

export interface LogTailerResult {
  watcher: fs.FSWatcher;
  cleanup: () => void;
}

/**
 * Processor for JSON log operations.
 * Injected by caller to keep lib pure.
 */
export interface JsonLogProcessor {
  /** Parse JSON log file into events and raw lines */
  parse: (file: string) => { events: any[]; lines: string[] };
  /** Check if an event should be filtered out */
  isNoise: (line: string, event: any) => boolean;
  /** Summarize an event for display */
  summarize: (event: any, line: string) => string;
}

// =============================================================================
// Text Log Functions (Pure)
// =============================================================================

/**
 * Show recent lines from a text log file
 */
export function showRecentTextLog(logFile: string, lines: number = 20): void {
  if (!fs.existsSync(logFile)) return;
  const content = fs.readFileSync(logFile, 'utf8');
  const allLines = content.split('\n');
  const recentLines = allLines.slice(-lines).join('\n');
  if (recentLines.trim()) {
    console.log('[...recent output...]\n');
    console.log(recentLines);
  }
}

/**
 * Create a watcher for text log file tailing
 */
export function createTextLogTailer(logFile: string): LogTailerResult {
  let lastSize = fs.statSync(logFile).size;

  const watcher = fs.watch(logFile, (eventType) => {
    if (eventType === 'change') {
      try {
        const newSize = fs.statSync(logFile).size;
        if (newSize > lastSize) {
          const fd = fs.openSync(logFile, 'r');
          const buffer = Buffer.alloc(newSize - lastSize);
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);
          process.stdout.write(buffer.toString());
          lastSize = newSize;
        }
      } catch { /* ignore */ }
    }
  });

  return {
    watcher,
    cleanup: () => watcher.close()
  };
}

// =============================================================================
// JSON Log Functions (With Injected Processor)
// =============================================================================

/**
 * Show recent events from a jsonlog file
 * @param processor - Injected processor for parsing/filtering/summarizing
 * @param rawOutput - If true, output raw JSON lines without processing
 */
export function showRecentJsonLog(
  jsonLogFile: string,
  lines: number = 20,
  processor: JsonLogProcessor,
  rawOutput: boolean = false
): void {
  if (!fs.existsSync(jsonLogFile)) return;

  if (rawOutput) {
    // Raw mode: just output the last N lines as-is
    const content = fs.readFileSync(jsonLogFile, 'utf8');
    const allLines = content.split('\n').filter(l => l.trim());
    const recentLines = allLines.slice(-lines);
    for (const line of recentLines) {
      console.log(line);
    }
    return;
  }

  const { events, lines: rawLines } = processor.parse(jsonLogFile);
  const recentEvents = events.slice(-lines);
  const recentRawLines = rawLines.slice(-lines);

  let shown = 0;
  for (let i = 0; i < recentEvents.length; i++) {
    const event = recentEvents[i];
    const line = recentRawLines[i];
    if (!processor.isNoise(line, event)) {
      console.log(processor.summarize(event, line));
      shown++;
    }
  }
  if (shown > 0) {
    console.log(''); // blank line after recent events
  }
}

/**
 * Create a watcher for jsonlog file tailing with noise filtering
 * @param processor - Injected processor for parsing/filtering/summarizing
 * @param rawOutput - If true, output raw JSON lines without processing
 */
export function createJsonLogTailer(
  jsonLogFile: string,
  processor: JsonLogProcessor,
  rawOutput: boolean = false
): LogTailerResult {
  let lastSize = fs.statSync(jsonLogFile).size;
  let buffer = '';

  const watcher = fs.watch(jsonLogFile, (eventType) => {
    if (eventType === 'change') {
      try {
        const newSize = fs.statSync(jsonLogFile).size;
        if (newSize > lastSize) {
          const fd = fs.openSync(jsonLogFile, 'r');
          const readBuffer = Buffer.alloc(newSize - lastSize);
          fs.readSync(fd, readBuffer, 0, readBuffer.length, lastSize);
          fs.closeSync(fd);
          buffer += readBuffer.toString();
          lastSize = newSize;

          // Process complete lines
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (line.trim()) {
              if (rawOutput) {
                // Raw mode: output line as-is
                console.log(line);
              } else {
                try {
                  const event = JSON.parse(line);
                  if (!processor.isNoise(line, event)) {
                    console.log(processor.summarize(event, line));
                  }
                } catch { /* ignore parse errors */ }
              }
            }
          }
        }
      } catch { /* ignore */ }
    }
  });

  return {
    watcher,
    cleanup: () => watcher.close()
  };
}

// =============================================================================
// Helper: Create No-Op Processor
// =============================================================================

/**
 * Create a basic processor that does no filtering and minimal summarization.
 * Useful for simple JSON log viewing without noise filtering.
 */
export function createBasicProcessor(): JsonLogProcessor {
  return {
    parse: (file: string) => {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      const events = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
      return { events, lines };
    },
    isNoise: () => false,
    summarize: (event, line) => {
      if (event.type) {
        return `[${event.type}] ${event.message || JSON.stringify(event).slice(0, 100)}`;
      }
      return line.slice(0, 120);
    }
  };
}
