-- AlterTable
ALTER TABLE "AdJob" ADD COLUMN     "outputPath" TEXT,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0;
