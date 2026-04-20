-- AlterEnum: add PREVIEW between CREATOR and ADMIN (Postgres appends enum values at end;
-- Prisma order in schema is logical only; DB stores enum label.)
ALTER TYPE "Role" ADD VALUE 'PREVIEW';
