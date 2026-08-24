import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckinRequestDto {
  @ApiProperty({
    description: 'Token do voucher do aluno, lido do QR Code (Student#token no Checkin Pai).',
    example: 'b2f6c1e0-9a3d-4e21-8c3a-9c6e2f6a1d4b',
  })
  @IsString()
  @IsNotEmpty()
  studentToken: string;

  @ApiPropertyOptional({
    description:
      'ID do Course (turma) selecionado na tela de check-in. Se informado, o check-in só é aceito se o aluno pertencer a essa turma (mesma validação do Checkin Pai — ver CheckinProcessorService).',
  })
  @IsInt()
  @IsOptional()
  courseId?: number;

  @ApiPropertyOptional({
    description: 'UID/nome da impressora local a usar. Se omitido, usa a impressora padrão configurada (print.defaultPrinter).',
  })
  @IsString()
  @IsOptional()
  printerUid?: string;
}
