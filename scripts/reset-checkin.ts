import 'dotenv/config';
import { LocalPrismaService } from '../src/database/local-prisma.service';

// Reseta o check-in de um aluno na réplica local (SQLite) desta estação,
// para permitir testar o credenciamento de novo sem esperar sincronização.
//
// Uso: npm run reset-checkin -- <token>

const TOKEN = process.argv[2];

async function main() {
  if (!TOKEN) {
    console.error('Uso: npm run reset-checkin -- <token>');
    process.exit(1);
  }

  const prisma = new LocalPrismaService();
  await prisma.onModuleInit();

  try {
    const student = await prisma.student.findUnique({ where: { token: TOKEN } });

    if (!student) {
      console.error(`Nenhum aluno encontrado com o token "${TOKEN}" na base local.`);
      process.exit(1);
    }

    console.log(
      `Antes: ${student.name} — checkedIn=${student.checkedIn} checkedInAt=${student.checkedInAt}`,
    );

    const updated = await prisma.student.update({
      where: { token: TOKEN },
      data: { checkedIn: false, checkedInAt: null },
    });

    console.log(
      `Depois: ${updated.name} — checkedIn=${updated.checkedIn} checkedInAt=${updated.checkedInAt}`,
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
