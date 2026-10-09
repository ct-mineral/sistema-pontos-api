ALTER TABLE "time_records" ADD COLUMN "group_id" UUID;

ALTER TABLE "time_records" ADD CONSTRAINT "time_records_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workload_adjustments" ADD COLUMN "group_id" UUID;

ALTER TABLE "workload_adjustments" ADD CONSTRAINT "workload_adjustments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
