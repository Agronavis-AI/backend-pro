import winston from 'winston';
import { env } from './env';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const humanFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts as string} ${level} ${(stack as string) ?? (message as string)}${extra}`;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  levels: winston.config.npm.levels,
  format: env.isProduction
    ? combine(errors({ stack: true }), timestamp(), json())
    : combine(errors({ stack: true }), timestamp({ format: 'HH:mm:ss' }), colorize(), humanFormat),
  transports: [new winston.transports.Console({ silent: env.isTest })],
});
