import { logger } from '../../src/utils/logger.js';

process.env.LOG_LEVEL = 'silent';
logger.setLevel('silent');

jest.setTimeout(90000);
