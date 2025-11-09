/**
 * Logging utility for audit trails and debugging
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private level: LogLevel;
  private operationId = 0;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private log(level: LogLevel, message: string, data?: any) {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...(data && { data })
    };

    const output = JSON.stringify(logEntry);

    if (level === 'error') {
      console.error(output);
    } else {
      console.error(output); // Use stderr for all logs to not interfere with MCP stdio
    }
  }

  debug(message: string, data?: any) {
    this.log('debug', message, data);
  }

  info(message: string, data?: any) {
    this.log('info', message, data);
  }

  warn(message: string, data?: any) {
    this.log('warn', message, data);
  }

  error(message: string, data?: any) {
    this.log('error', message, data);
  }

  getNextOperationId(): number {
    return ++this.operationId;
  }

  logOperation(operation: string, details: any, beforeState?: any, afterState?: any) {
    const opId = this.getNextOperationId();
    this.info(`Operation: ${operation}`, {
      operationId: opId,
      details,
      ...(beforeState && { beforeState }),
      ...(afterState && { afterState })
    });
    return opId;
  }
}

export const logger = new Logger(
  (process.env.HUBSPOT_LOG_LEVEL as LogLevel) || 'info'
);
