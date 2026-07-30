import 'dotenv/config';
import { env } from 'prisma/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client';

const adapter = new PrismaMariaDb({
  host: env('DATABASE_HOST'),
  port: 3306,
  connectionLimit: 5,
});

const prisma = new PrismaClient({ adapter });

export default prisma;
