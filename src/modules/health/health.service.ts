import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  check() {
    return {
      status: 'OK',
      message: 'API is running',
      timestamp: new Date().toISOString(),
    };
  }
}
