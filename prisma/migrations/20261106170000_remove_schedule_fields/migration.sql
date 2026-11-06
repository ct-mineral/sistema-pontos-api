-- Remove schedule fields after migrating the application to workload-only groups.
ALTER TABLE "groups"
  DROP COLUMN "start_time",
  DROP COLUMN "end_time",
  DROP COLUMN "break_start_time",
  DROP COLUMN "break_end_time",
  DROP COLUMN "auto_punch_time";

ALTER TABLE "workload_adjustments"
  DROP COLUMN "start_time",
  DROP COLUMN "end_time";