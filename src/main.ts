import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const frontend = app
    .get(ConfigService)
    .get<string>('FRONTEND_URL')
    ?.replace(/\/$/, '');

  app.setGlobalPrefix('api');
  if (frontend) {
    app.enableCors({ origin: frontend, credentials: true });
  }
  if (process.env.VERCEL === '1') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
