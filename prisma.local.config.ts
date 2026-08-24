import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Configuração do Prisma para o banco LOCAL (SQLite/WAL) do Checkin Pocket.
// Uso:
//   npx prisma generate --config prisma.local.config.ts
//   npx prisma migrate deploy --config prisma.local.config.ts
//   npx prisma migrate dev --config prisma.local.config.ts
export default defineConfig({
  schema: 'prisma/local/schema.prisma',
  migrations: {
    path: 'prisma/local/migrations',
  },
  datasource: {
    url: env('LOCAL_DATABASE_URL'),
  },
});
