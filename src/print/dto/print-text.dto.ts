import { IsString, IsOptional, IsNumber, IsBoolean, Min } from 'class-validator';

export class PrintTextDto {
  @IsString()
  @IsOptional()
  printerName?: string;

  /**
   * Uso interno (LocalPrintWorkerService) — força o caminho comprovado
   * (Sumatra) mesmo com PRINT_USE_RAW_RASTER=true. Usado nos retries de um
   * print_job depois que a 1ª tentativa via raw falhou, pra não repetir o
   * mesmo caminho experimental indefinidamente num evento ao vivo. Nunca
   * setado por chamadas HTTP externas (PrintController não expõe isso).
   */
  @IsBoolean()
  @IsOptional()
  forceSumatra?: boolean;

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
