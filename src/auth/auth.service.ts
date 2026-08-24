import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { LocalPrismaService } from '../database/local-prisma.service';
import { LoginDto } from './dto/login.dto';
import { AuthenticatedOperator, LoginResult } from './interfaces/login-result.interface';

/**
 * Login LOCAL do operador desta estação.
 *
 * Valida e-mail/senha contra o cache local de `Operator` (SQLite),
 * populado e mantido em dia pelo AuthSyncService a partir do banco do
 * Checkin Pai. Nunca consulta o banco do Pai diretamente durante o login —
 * assim o credenciamento continua funcionando mesmo com a estação
 * offline, desde que já tenha havido ao menos uma sincronização de auth
 * bem-sucedida desde o último boot.
 *
 * O JWT emitido usa o mesmo segredo/estratégia (`JwtAuthGuard`/'jwt') já
 * usado pelas rotas de checkin/students/print, então o mesmo token cobre
 * toda a estação.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly localPrisma: LocalPrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const operator = await this.localPrisma.operator.findUnique({
      where: { email: dto.email },
    });

    if (!operator) {
      throw new UnauthorizedException(
        'Operador não encontrado no cache local desta estação. Verifique o e-mail ou aguarde a sincronização de autenticação com o Checkin Pai (ver GET /auth/sync-status).',
      );
    }

    const passwordMatches = await bcrypt.compare(dto.password, operator.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const authenticatedOperator: AuthenticatedOperator = {
      id: operator.id,
      remoteUserId: operator.remoteUserId,
      email: operator.email,
      name: operator.name,
      status: operator.status,
      courseType: operator.courseType,
    };

    const accessToken = await this.jwtService.signAsync({
      sub: operator.id,
      username: operator.email,
      name: operator.name,
      status: operator.status,
      courseType: operator.courseType,
    });

    return { accessToken, operator: authenticatedOperator };
  }
}
