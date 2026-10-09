-- DropForeignKey
ALTER TABLE "time_records" DROP CONSTRAINT "time_records_group_id_fkey";

-- DropForeignKey
ALTER TABLE "workload_adjustments" DROP CONSTRAINT "workload_adjustments_group_id_fkey";

-- AddForeignKey
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_adjustments" ADD CONSTRAINT "workload_adjustments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
