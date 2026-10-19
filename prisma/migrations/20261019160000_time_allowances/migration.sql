-- CreateEnum
CREATE TYPE "AllowanceStatus" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO');

-- CreateTable
CREATE TABLE "time_allowances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "AllowanceStatus" NOT NULL DEFAULT 'PENDENTE',
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "time_allowances_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "time_allowances" ADD CONSTRAINT "time_allowances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_allowances" ADD CONSTRAINT "time_allowances_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_allowances" ADD CONSTRAINT "time_allowances_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
