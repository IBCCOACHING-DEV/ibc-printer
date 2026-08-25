import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { join } from 'node:path';

export interface LabelContent {
  name: string;
  nickname: string;
  course?: string;
}

// Mesmas dimensões/tamanhos de fonte do layout HTML que este módulo
// substitui (ver histórico de linux-printer.service.ts/windows-printer.service.ts)
// — preserva o tamanho físico já validado na impressora, trocando só o
// motor de renderização (Puppeteer/Chromium por canvas nativo).
const CANVAS_WIDTH = 3000;
const NICKNAME_FONT_SIZE = 230;
const NAME_FONT_SIZE = 170;
const COURSE_FONT_SIZE = 120;
const NAME_MARGIN_BOTTOM = 10;
const LINE_HEIGHT_FACTOR = 1.15;
const FONT_FAMILY = 'Liberation Sans';

/**
 * Registra a fonte embutida no projeto (Liberation Sans — SIL OFL,
 * metricamente compatível com Arial) em vez de depender de "Arial" estar
 * instalada e ser localizável pelo motor de fontes do canvas (Skia) no
 * sistema operacional. Sem isso, glyphs não encontrados saem como
 * retângulos ("tofu") na etiqueta impressa — foi exatamente o que
 * aconteceu confiando na fonte do sistema.
 *
 * __dirname aqui é `src/print` em dev (ts-node) e `dist/src/print` no
 * build — em ambos os casos `../../assets/fonts` chega na pasta
 * `assets/fonts` na raiz do projeto (ver nest-cli.json para a cópia desses
 * arquivos para `dist/assets/fonts` no build).
 */
function registerBundledFonts(): void {
  if (GlobalFonts.has(FONT_FAMILY)) {
    return;
  }

  const fontsDir = join(__dirname, '../../assets/fonts');
  GlobalFonts.registerFromPath(join(fontsDir, 'LiberationSans-Regular.ttf'), FONT_FAMILY);
  GlobalFonts.registerFromPath(join(fontsDir, 'LiberationSans-Bold.ttf'), FONT_FAMILY);
}

registerBundledFonts();

/**
 * Renderiza a etiqueta de credenciamento (apelido + nome + turma) como PNG
 * usando canvas nativo, sem abrir navegador — o gargalo original era o
 * Puppeteer/Chromium sendo lançado do zero a cada etiqueta (~1-2s por
 * chamada). Isso reduz esse trecho para poucos milissegundos.
 */
export function renderLabelPng({ name, nickname, course }: LabelContent): Buffer {
  const nicknameLineHeight = NICKNAME_FONT_SIZE * LINE_HEIGHT_FACTOR;
  const nameLineHeight = NAME_FONT_SIZE * LINE_HEIGHT_FACTOR + NAME_MARGIN_BOTTOM;
  const courseLineHeight = course ? COURSE_FONT_SIZE * LINE_HEIGHT_FACTOR : 0;
  const canvasHeight = Math.ceil(nicknameLineHeight + nameLineHeight + courseLineHeight);

  const canvas = createCanvas(CANVAS_WIDTH, canvasHeight);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight);
  ctx.textBaseline = 'top';

  let y = 0;

  ctx.fillStyle = '#333333';
  ctx.font = `bold ${NICKNAME_FONT_SIZE}px "${FONT_FAMILY}"`;
  ctx.fillText(nickname, 0, y);
  y += nicknameLineHeight;

  ctx.fillStyle = '#000000';
  ctx.font = `${NAME_FONT_SIZE}px "${FONT_FAMILY}"`;
  ctx.fillText(name, 0, y);
  y += nameLineHeight;

  if (course) {
    ctx.fillStyle = '#666666';
    ctx.font = `${COURSE_FONT_SIZE}px "${FONT_FAMILY}"`;
    ctx.fillText(course, 0, y);
  }

  return canvas.toBuffer('image/png');
}
