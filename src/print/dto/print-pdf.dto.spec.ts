import { validate } from 'class-validator';
import { PrintPdfDto } from './print-pdf.dto';

describe('PrintPdfDto', () => {
  it('should validate correct PDF DTO', async () => {
    const dto = new PrintPdfDto();
    dto.pdfData =
      'JVBERi0xLjUKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCg==';
    dto.printerName = 'test-printer';
    dto.copies = 1;
    dto.paperSize = 'A4';
    dto.orientation = 'portrait';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail with invalid base64', async () => {
    const dto = new PrintPdfDto();
    dto.pdfData = 'invalid-base64!@#$';
    dto.copies = 1;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('pdfData');
  });

  it('should fail with invalid copies', async () => {
    const dto = new PrintPdfDto();
    dto.pdfData = 'valid-base64';
    dto.copies = 0;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('copies');
  });

  it('should fail with invalid paper size', async () => {
    const dto = new PrintPdfDto();
    dto.pdfData = 'valid-base64';
    dto.paperSize = 'INVALID_SIZE';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('paperSize');
  });
});
