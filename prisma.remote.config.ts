import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Configuração do Prisma para o banco PRINCIPAL do Checkin Pai (MySQL
// "checkin"), acessado pelo Checkin Pocket em modo SOMENTE LEITURA.
//
// Uso:
//   npx prisma generate --config prisma.remote.config.ts
//
// Propositalmente NÃO há script de "migrate" para este schema: o banco é de
// propriedade do Checkin Pai (Rails) e o Pocket nunca deve alterar sua
// estrutura ou dados — apenas ler `users`/`courses`/`students`.
//
// A URL abaixo é usada somente pelo CLI do Prisma (generate/introspect). Em
// runtime, o RemotePaiPrismaService conecta via `@prisma/adapter-mariadb`
// usando as variáveis PAI_DATABASE_HOST/PORT/NAME/USER/PASSWORD, do mesmo
// jeito que a conexão legada "ibc_printer" (ver src/lib/prisma.ts).
export default defineConfig({
  schema: 'prisma/remote/schema.prisma',
  datasource: {
    url: env('PAI_DATABASE_URL'),
  },
});
