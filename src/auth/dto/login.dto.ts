import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'E-mail do operador (mesmo cadastrado no Checkin Pai).' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Senha do operador (mesma senha do Checkin Pai).' })
  @IsString()
  @MinLength(1)
  password: string;
}
