import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { jwtOptions } from './jwt/jwt.config';
import { ApiKeyStrategy } from './strategies/api-key.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({ ...jwtOptions, global: true }),
  ],
  providers: [ApiKeyStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
