import { IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class PrintTextDto {
  @IsString()
  text: string;

  @IsString()
  @IsOptional()
  printerName?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  copies?: number = 1;
}
