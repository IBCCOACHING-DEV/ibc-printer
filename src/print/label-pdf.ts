import * as PDFDocument from 'pdfkit';
import { PassThrough } from 'node:stream';

const MM_TO_PT = 72 / 25.4;
const mm = (value: number) => value * MM_TO_PT;

// Etiqueta física 29x90mm (Brother QL-810W, paisagem) já configurada como
// mídia padrão no driver. OFFSET_X/Y e PRINTABLE_WIDTH/HEIGHT vêm do
// PageImageableSize das capacidades do driver (Get-PrintConfiguration) — a
// impressora tem uma margem não-marcável de ~3mm à esquerda e ~1.5mm em
// cima; posicionar o conteúdo em (0,0) da página corta as primeiras letras.
const PAGE_WIDTH_MM = 90;
const PAGE_HEIGHT_MM = 29;
const PRINTABLE_OFFSET_X_MM = 3.0;
const PRINTABLE_OFFSET_Y_MM = 1.5;
const PRINTABLE_WIDTH_MM = 83.9;
const PRINTABLE_HEIGHT_MM = 25.9;

/**
 * Gera a etiqueta de credenciamento como PDF de página única, do tamanho
 * físico exato da etiqueta (sem depender de DPI/metadados da imagem).
 *
 * Impresso com `-print-settings noscale` no SumatraPDF, o PDF sai no
 * tamanho declarado — diferente de `PrintDocument`/GDI (que reamostra a
 * imagem em tempo real e travava ~2.3-2.9s por etiqueta, ver histórico) ou
 * de `mspaint /pt` (que ignora/mal-interpreta o DPI do PNG e imprime
 * minúsculo).
 */
export function wrapPngInLabelPdf(pngBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [mm(PAGE_WIDTH_MM), mm(PAGE_HEIGHT_MM)], margin: 0 });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    doc.on('error', reject);

    doc.pipe(stream);
    doc.image(pngBuffer, mm(PRINTABLE_OFFSET_X_MM), mm(PRINTABLE_OFFSET_Y_MM), {
      fit: [mm(PRINTABLE_WIDTH_MM), mm(PRINTABLE_HEIGHT_MM)],
    });
    doc.end();
  });
}
