#!/usr/bin/env node

import { V2MCPServer } from './server/V2MCPServer.js';
import { getConfig, validateConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

interface AppError extends Error {
  code?: string;
}

async function main() {
  try {
    const config = getConfig();
    logger.debug('Configuration loaded', config);

    const validation = validateConfig(config);
    if (!validation.valid) {
      logger.error('Configuration validation failed');
      validation.errors.forEach((error) => logger.error(error));
      process.exit(1);
    }

    logger.info('Creating MCP server instance');
    const server = new V2MCPServer(config);

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down');
      await server.close();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', reason);
      process.exit(1);
    });

    logger.info('Starting MCP server');
    await server.start();
    logger.info('MCP server started successfully');
    logger.info('MCP server is running. Press Ctrl+C to stop.');
  } catch (error) {
    const appError = error as AppError;

    logger.error('Failed to start MCP server', appError);

    if (appError.code === 'EADDRINUSE') {
      logger.error('Port is already in use. Check for another running instance.');
    }

    if (appError.message?.includes('credentials')) {
      logger.error('Authentication failed. Check your configured API credentials.');
    }

    process.exit(1);
  }
}

main();
