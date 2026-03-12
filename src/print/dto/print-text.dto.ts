import { IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class PrintTextDto {
  @IsString()
  @IsOptional()
  printerName?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  copies?: number = 1;

  @IsString()
  name: string;

  @IsString()
  nickname: string;

  @IsString()
  @IsOptional()
  course?: string;
}
