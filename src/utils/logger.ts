/**
 * Lightweight stderr logger for MCP-safe runtime output.
 */

import chalk from 'chalk';

export type LogLevel = 'silent' | 'debug' | 'info' | 'warn' | 'error';

const LEVELS: LogLevel[] = ['silent', 'debug', 'info', 'warn', 'error'];

function serializeArgs(args: unknown[]): string {
  if (args.length === 0) {
    return '';
  }

  const seen = new WeakSet<object>();

  try {
    return ` ${JSON.stringify(args, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }

      if (typeof value === 'bigint') {
        return `${value}n`;
      }

      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }

      return value;
    })}`;
  } catch {
    return ` ${args.map((arg) => String(arg)).join(' ')}`;
  }
}

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: Exclude<LogLevel, 'silent'>): boolean {
    if (this.level === 'silent') {
      return false;
    }

    return LEVELS.indexOf(level) >= LEVELS.indexOf(this.level);
  }

  private formatMessage(level: Exclude<LogLevel, 'silent'>, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${serializeArgs(args)}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.error(chalk.gray(this.formatMessage('debug', message, ...args)));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(chalk.blue(this.formatMessage('info', message, ...args)));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.error(chalk.yellow(this.formatMessage('warn', message, ...args)));
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red(this.formatMessage('error', message, ...args)));
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(chalk.green(this.formatMessage('info', message, ...args)));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger((process.env.LOG_LEVEL as LogLevel) || 'info');
