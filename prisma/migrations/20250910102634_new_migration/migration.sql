-- CreateTable
CREATE TABLE "public"."Machine" (
    "machine_id" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TIMESTAMP(3) NOT NULL,
    "rating" TEXT NOT NULL,
    "machine_status" BOOLEAN NOT NULL,
    "machine_type" TEXT NOT NULL,
    "machine_capacity" INTEGER NOT NULL,
    "total_coils" INTEGER NOT NULL,
    "password" TEXT NOT NULL,
    "date_created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_units" INTEGER NOT NULL,
    "last_refill_time" TIMESTAMP(3),
    "last_refill_by" TEXT,
    "last_refill_availability" TEXT,
    "availability" TEXT,
    "last_transaction" TIMESTAMP(3),
    "accumulated_downtime" TEXT,
    "time_difference_from_last_transaction" TEXT,
    "last_report_time" TIMESTAMP(3),
    "refill_report_time_difference" TEXT,
    "variety_score" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("machine_id")
);
