-- CreateTable
CREATE TABLE "students" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "course_id" INTEGER NOT NULL,
    "course_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ibc_customer_id" INTEGER,
    "checked_in" BOOLEAN NOT NULL DEFAULT false,
    "checked_in_at" DATETIME,
    "synced_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "printer_agents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agent_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'online',
    "version" TEXT,
    "metadata_json" TEXT,
    "last_seen_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "printers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "printer_agent_id" INTEGER,
    "printer_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_online" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "printers_printer_agent_id_fkey" FOREIGN KEY ("printer_agent_id") REFERENCES "printer_agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "student_id" INTEGER,
    "course_id" INTEGER,
    "target_printer_uid" TEXT NOT NULL,
    "label_name" TEXT NOT NULL,
    "label_course_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'local',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "idempotency_key" TEXT NOT NULL,
    "result_json" TEXT,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "print_jobs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "print_job_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "print_job_id" INTEGER NOT NULL,
    "printer_agent_id" INTEGER,
    "started_at" DATETIME NOT NULL,
    "finished_at" DATETIME,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "print_job_attempts_print_job_id_fkey" FOREIGN KEY ("print_job_id") REFERENCES "print_jobs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "print_job_attempts_printer_agent_id_fkey" FOREIGN KEY ("printer_agent_id") REFERENCES "printer_agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "students_token_key" ON "students"("token");

-- CreateIndex
CREATE INDEX "students_checked_in_idx" ON "students"("checked_in");

-- CreateIndex
CREATE UNIQUE INDEX "printer_agents_agent_key_key" ON "printer_agents"("agent_key");

-- CreateIndex
CREATE UNIQUE INDEX "printers_printer_uid_key" ON "printers"("printer_uid");

-- CreateIndex
CREATE UNIQUE INDEX "print_jobs_idempotency_key_key" ON "print_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "print_jobs_status_priority_created_at_idx" ON "print_jobs"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");
