import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SearchStudentsQueryDto {
  @ApiProperty({
    description: 'Termo de busca — casa contra nome, e-mail ou documento (mínimo 2 caracteres).',
    example: 'maria',
  })
  @IsString()
  @MinLength(2)
  q: string;
}
