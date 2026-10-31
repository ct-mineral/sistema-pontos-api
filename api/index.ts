import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';

const server = express();
let bootstrapPromise: Promise<void> | undefined;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  await app.init();
}

export default async function handler(
  request: express.Request,
  response: express.Response,
) {
  bootstrapPromise ??= bootstrap();
  await bootstrapPromise;

  return server(request, response);
}
