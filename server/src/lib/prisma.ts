import { PrismaClient } from "@prisma/client"

declare global {
  // Prevent multiple instances during dev hot reload
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

export const prisma =
  global.prisma ??
  new PrismaClient({
    log: ["error"]
  })

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma
}