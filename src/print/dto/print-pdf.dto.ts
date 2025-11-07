import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  IsBase64,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PrintPdfDto {
  @ApiProperty({
    description: 'Dados do PDF em base64',
    example: 'JVBERi0xLjcKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwov...',
  })
  @IsBase64({}, { message: 'pdfData deve ser uma string base64 válida' })
  pdfData: string;

  @ApiPropertyOptional({
    description: 'Nome da impressora (usar padrão do sistema se não informado)',
    example: 'HP-LaserJet-Pro-MFP',
  })
  @IsString()
  @IsOptional()
  printerName?: string;

  @ApiPropertyOptional({
    description: 'Número de cópias',
    minimum: 1,
    default: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  copies?: number = 1;

  @ApiPropertyOptional({
    description: 'Tamanho do papel',
    enum: ['A4', 'A5', 'LETTER', 'LEGAL'],
    default: 'A4',
  })
  @IsString()
  @IsIn(['A4', 'A5', 'LETTER', 'LEGAL'])
  @IsOptional()
  paperSize?: string = 'A4';

  @ApiPropertyOptional({
    description: 'Orientação da página',
    enum: ['portrait', 'landscape'],
    default: 'portrait',
  })
  @IsString()
  @IsIn(['portrait', 'landscape'])
  @IsOptional()
  orientation?: string = 'portrait';
}
