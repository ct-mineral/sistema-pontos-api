-- CreateEnum
CREATE TYPE "JustificationStatus" AS ENUM ('PENDENTE', 'APROVADA', 'RECUSADA');

-- CreateTable
CREATE TABLE "early_exit_justifications" (
    "id" UUID NOT NULL,
    "time_record_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "scheduled_end" VARCHAR(5) NOT NULL,
    "status" "JustificationStatus" NOT NULL DEFAULT 'PENDENTE',
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "early_exit_justifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "early_exit_justifications_time_record_id_key" ON "early_exit_justifications"("time_record_id");

-- AddForeignKey
ALTER TABLE "early_exit_justifications" ADD CONSTRAINT "early_exit_justifications_time_record_id_fkey" FOREIGN KEY ("time_record_id") REFERENCES "time_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_exit_justifications" ADD CONSTRAINT "early_exit_justifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_exit_justifications" ADD CONSTRAINT "early_exit_justifications_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
