import 'dotenv/config';
import { env } from 'prisma/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client';

const adapter = new PrismaMariaDb({
  host: env('DATABASE_HOST'),
  user: env('DATABASE_USER'),
  password: env('DATABASE_PASSWORD'),
  database: env('DATABASE_NAME'),
  port: Number(env('DATABASE_PORT')),
  connectionLimit: 20,
});

const prisma = new PrismaClient({ adapter });

export default prisma;
