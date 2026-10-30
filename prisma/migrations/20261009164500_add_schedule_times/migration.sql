ALTER TABLE "groups" ADD COLUMN "start_time" VARCHAR(5),
ADD COLUMN "end_time" VARCHAR(5);

ALTER TABLE "workload_adjustments" ADD COLUMN "start_time" VARCHAR(5),
ADD COLUMN "end_time" VARCHAR(5);
