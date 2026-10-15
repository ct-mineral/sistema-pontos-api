-- AlterEnum
ALTER TYPE "JustificationStatus" ADD VALUE 'APROVADA_PARCIAL';

-- AlterTable
ALTER TABLE "early_exit_justifications" ADD COLUMN "makeup_date" DATE,
ADD COLUMN "makeup_start" VARCHAR(5),
ADD COLUMN "makeup_end" VARCHAR(5);
