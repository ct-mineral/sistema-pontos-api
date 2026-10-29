import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const adapter = new PrismaPg(
      poolConfig(configService.getOrThrow<string>('DATABASE_URL')),
    );
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

function poolConfig(connectionString: string) {
  if (process.env.VERCEL !== '1') return { connectionString };

  const local = /@(localhost|127\.0\.0\.1)(?::|\/)/.test(connectionString);
  return {
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    ssl: local ? undefined : { rejectUnauthorized: false },
  };
}
