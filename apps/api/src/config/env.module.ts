import { Global, Module } from '@nestjs/common';
import { loadEnv } from './env';

/** DI token for the validated, resolved environment. */
export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
