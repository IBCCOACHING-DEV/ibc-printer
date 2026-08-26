import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { join } from 'node:path';

export interface LabelContent {
  name: string;
  nickname: string;
  course?: string;
}

// Protocolo raster da Brother QL-810W (família QL-800/810W/820NWB),
// confirmado fisicamente nesta estação — valores cross-checados contra a
// biblioteca de referência pklaus/brother_ql (implementada a partir do
// manual oficial da Brother) e contra o comportamento real da impressora.
// Ver histórico da investigação em CLAUDE.md §5 e no plano
// purring-rolling-puffin.md.
const LINE_BUFFER_BYTES = 90; // number_bytes_per_row do modelo QL-810W (720 dots — largura total do cabeçote)
const FULL_LINE_DOTS = LINE_BUFFER_BYTES * 8;
const NUM_INVALIDATE_BYTES = 400; // específico do QL-810W (a lib de referência usa 200 como default genérico)
const MEDIA_WIDTH_MM = 29;
const MEDIA_LENGTH_MM = 90;
const MTYPE_DIE_CUT = 0x0b;
// Mídia "29x90" (die-cut): dots_printable=(306,991), offset_r=6 — únicos
// valores usados por esta estação (impressoras Brother QL-810W com
// etiquetas DK-1201-class 29x90mm, ver CLAUDE.md §1).
const ACTIVE_WIDTH_DOTS = 306;
const TOTAL_LINES = 991; // SEMPRE enviar o total — cortar com menos linhas corta a etiqueta física no meio (confirmado fisicamente)
const OFFSET_R = 6;
// Posição do conteúdo ANTES do espelhamento esquerda-direita que o
// protocolo exige (offset_r é medido a partir da borda direita nesse
// sistema de coordenadas pré-espelhamento) — confirmado fisicamente: sem
// esse espelhamento, o conteúdo cai fora da área com papel e não imprime
// nada visível.
const PRE_FLIP_LEFT_PAD = FULL_LINE_DOTS - ACTIVE_WIDTH_DOTS - OFFSET_R;

const FONT_FAMILY = 'Liberation Sans';

function registerBundledFonts(): void {
  if (GlobalFonts.has(FONT_FAMILY)) {
    return;
  }
  const fontsDir = join(__dirname, '../../assets/fonts');
  GlobalFonts.registerFromPath(join(fontsDir, 'LiberationSans-Regular.ttf'), FONT_FAMILY);
  GlobalFonts.registerFromPath(join(fontsDir, 'LiberationSans-Bold.ttf'), FONT_FAMILY);
}

registerBundledFonts();

// Mesma escala de fontes usada em label-image.ts (CANVAS_WIDTH=3000 pros
// mesmos 90mm de comprimento), reaplicada em dots nativos (300dpi) em vez
// de um canvas de tamanho arbitrário.
const SCALE = TOTAL_LINES / 3000;
const NICKNAME_FONT_SIZE = Math.round(230 * SCALE);
const NAME_FONT_SIZE = Math.round(170 * SCALE);
const COURSE_FONT_SIZE = Math.round(120 * SCALE);
const NAME_MARGIN_BOTTOM = Math.round(10 * SCALE);
const LINE_HEIGHT_FACTOR = 1.15;
const THRESHOLD = 128; // limiar fixo preto/branco — ver label-raster.ts vs label-image.ts (sem anti-aliasing em raster puro)

function renderLandscapeCanvas({ name, nickname, course }: LabelContent) {
  const nicknameLineHeight = NICKNAME_FONT_SIZE * LINE_HEIGHT_FACTOR;
  const nameLineHeight = NAME_FONT_SIZE * LINE_HEIGHT_FACTOR + NAME_MARGIN_BOTTOM;
  const courseLineHeight = course ? COURSE_FONT_SIZE * LINE_HEIGHT_FACTOR : 0;
  const contentHeight = Math.ceil(nicknameLineHeight + nameLineHeight + courseLineHeight);

  // Canvas em orientação paisagem (largura = comprimento da etiqueta,
  // altura = largura da etiqueta) — igual a label-image.ts. Rotacionado
  // 90° logo abaixo pra virar o sistema de coordenadas que o protocolo
  // raster espera (uma linha raster = uma fatia ao longo do comprimento).
  const canvas = createCanvas(TOTAL_LINES, ACTIVE_WIDTH_DOTS);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, TOTAL_LINES, ACTIVE_WIDTH_DOTS);
  ctx.textBaseline = 'top';

  const yStart = Math.max(0, Math.round((ACTIVE_WIDTH_DOTS - contentHeight) / 2));
  let y = yStart;

  ctx.fillStyle = '#000000';
  ctx.font = `bold ${NICKNAME_FONT_SIZE}px "${FONT_FAMILY}"`;
  ctx.fillText(nickname, 0, y);
  y += nicknameLineHeight;

  ctx.font = `${NAME_FONT_SIZE}px "${FONT_FAMILY}"`;
  ctx.fillText(name, 0, y);
  y += nameLineHeight;

  if (course) {
    ctx.font = `${COURSE_FONT_SIZE}px "${FONT_FAMILY}"`;
    ctx.fillText(course, 0, y);
  }

  return canvas;
}

/**
 * Rotaciona 90° (sentido horário) o canvas paisagem pra virar retrato
 * (largura=ACTIVE_WIDTH_DOTS, altura=TOTAL_LINES) — mesma convenção usada
 * pela biblioteca de referência pra mídia die-cut quando a imagem de
 * origem está em paisagem.
 */
function rotate90(landscapeCanvas: any): any {
  const rotated = createCanvas(ACTIVE_WIDTH_DOTS, TOTAL_LINES);
  const rctx = rotated.getContext('2d');
  rctx.translate(ACTIVE_WIDTH_DOTS, 0);
  rctx.rotate(Math.PI / 2);
  (rctx as any).drawImage(landscapeCanvas, 0, 0);
  return rotated;
}

function packRasterLines(rotatedCanvas: any): Buffer[] {
  const rctx = rotatedCanvas.getContext('2d');
  const { data } = rctx.getImageData(0, 0, ACTIVE_WIDTH_DOTS, TOTAL_LINES);

  const lines: Buffer[] = [];
  const fullRow = new Uint8Array(FULL_LINE_DOTS);

  for (let row = 0; row < TOTAL_LINES; row++) {
    fullRow.fill(0);
    for (let col = 0; col < ACTIVE_WIDTH_DOTS; col++) {
      const idx = (row * ACTIVE_WIDTH_DOTS + col) * 4;
      const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (luminance < THRESHOLD) {
        fullRow[PRE_FLIP_LEFT_PAD + col] = 1;
      }
    }
    fullRow.reverse(); // espelhamento esquerda-direita exigido pelo protocolo

    const lineBuf = Buffer.alloc(LINE_BUFFER_BYTES, 0x00);
    for (let bit = 0; bit < FULL_LINE_DOTS; bit++) {
      if (fullRow[bit]) {
        const byteIdx = bit >> 3;
        const bitIdx = 7 - (bit & 7); // MSB-first: dot 0 = bit 7
        lineBuf[byteIdx] |= 1 << bitIdx;
      }
    }
    lines.push(lineBuf);
  }

  return lines;
}

function escInit(): Buffer {
  return Buffer.from([0x1b, 0x40]); // ESC @
}

function invalidate(): Buffer {
  return Buffer.alloc(NUM_INVALIDATE_BYTES, 0x00);
}

function statusInformationCmd(): Buffer {
  return Buffer.from([0x1b, 0x69, 0x53]); // ESC i S
}

function rasterModeCmd(): Buffer {
  return Buffer.from([0x1b, 0x69, 0x61, 0x01]); // ESC i a 01
}

function mediaAndQualityCmd(rnumber: number): Buffer {
  const validFlags = 0x80 | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 6);
  const buf = Buffer.alloc(13);
  buf.writeUInt8(0x1b, 0);
  buf.writeUInt8(0x69, 1);
  buf.writeUInt8(0x7a, 2);
  buf.writeUInt8(validFlags, 3);
  buf.writeUInt8(MTYPE_DIE_CUT, 4);
  buf.writeUInt8(MEDIA_WIDTH_MM, 5);
  buf.writeUInt8(MEDIA_LENGTH_MM, 6);
  buf.writeUInt32LE(rnumber, 7);
  buf.writeUInt8(0, 11); // primeira página deste job
  buf.writeUInt8(0, 12);
  return buf;
}

function autocutCmd(enabled: boolean): Buffer {
  return Buffer.from([0x1b, 0x69, 0x4d, enabled ? 0x40 : 0x00]); // ESC i M
}

function cutEveryCmd(n: number): Buffer {
  return Buffer.from([0x1b, 0x69, 0x41, n & 0xff]); // ESC i A
}

function expandedModeCmd(cutAtEnd: boolean): Buffer {
  return Buffer.from([0x1b, 0x69, 0x4b, (cutAtEnd ? 1 : 0) << 3]); // ESC i K
}

function marginsCmd(dots: number): Buffer {
  const buf = Buffer.alloc(5);
  buf.writeUInt8(0x1b, 0);
  buf.writeUInt8(0x69, 1);
  buf.writeUInt8(0x64, 2);
  buf.writeUInt16LE(dots, 3);
  return buf;
}

function rasterLineCmd(lineBytes: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x67, 0x00, LINE_BUFFER_BYTES]), lineBytes]);
}

function printCmd(lastPage: boolean): Buffer {
  return Buffer.from([lastPage ? 0x1a : 0x0c]);
}

/**
 * Monta o job raster completo (bypass do GDI/driver) pra uma etiqueta de
 * credenciamento, pronto pra ser enviado via datatype RAW
 * (RawPrinterHelper.exe) — ver windows-printer.service.ts#printTextRaw.
 */
export function renderLabelRasterCommands(content: LabelContent): Buffer {
  const landscape = renderLandscapeCanvas(content);
  const rotated = rotate90(landscape);
  const lines = packRasterLines(rotated);

  const parts: Buffer[] = [
    rasterModeCmd(),
    invalidate(),
    escInit(),
    rasterModeCmd(),
    statusInformationCmd(),
    mediaAndQualityCmd(TOTAL_LINES),
    autocutCmd(true),
    cutEveryCmd(1),
    expandedModeCmd(true),
    marginsCmd(0),
  ];
  for (const line of lines) {
    parts.push(rasterLineCmd(line));
  }
  parts.push(printCmd(true));

  return Buffer.concat(parts);
}
