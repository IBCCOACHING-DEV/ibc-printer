import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import { AppModule } from '../src/app.module';
import { PrinterHubService } from '../src/printer-hub/printer-hub.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const service = app.get(PrinterHubService);

    const result = await (service as any).ackSuccess();

    console.log(result);
  } finally {
    await app.close;
  }
}

main().catch((error) => {
  console.log(error);
  process.exit(1);
});
