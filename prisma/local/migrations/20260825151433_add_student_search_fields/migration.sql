-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_operators" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "remote_user_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 3,
    "course_type" INTEGER NOT NULL DEFAULT 0,
    "authentication_token" TEXT,
    "synced_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_operators" ("authentication_token", "course_type", "created_at", "email", "id", "name", "password_hash", "remote_user_id", "status", "synced_at", "updated_at") SELECT "authentication_token", "course_type", "created_at", "email", "id", "name", "password_hash", "remote_user_id", "status", "synced_at", "updated_at" FROM "operators";
DROP TABLE "operators";
ALTER TABLE "new_operators" RENAME TO "operators";
CREATE UNIQUE INDEX "operators_remote_user_id_key" ON "operators"("remote_user_id");
CREATE UNIQUE INDEX "operators_email_key" ON "operators"("email");
CREATE TABLE "new_outbox_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_outbox_events" ("aggregate_id", "aggregate_type", "attempts", "created_at", "event_type", "id", "last_error", "payload", "routing_key", "status", "updated_at") SELECT "aggregate_id", "aggregate_type", "attempts", "created_at", "event_type", "id", "last_error", "payload", "routing_key", "status", "updated_at" FROM "outbox_events";
DROP TABLE "outbox_events";
ALTER TABLE "new_outbox_events" RENAME TO "outbox_events";
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");
CREATE TABLE "new_print_job_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "print_job_id" INTEGER NOT NULL,
    "printer_agent_id" INTEGER,
    "started_at" DATETIME NOT NULL,
    "finished_at" DATETIME,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "print_job_attempts_print_job_id_fkey" FOREIGN KEY ("print_job_id") REFERENCES "print_jobs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "print_job_attempts_printer_agent_id_fkey" FOREIGN KEY ("printer_agent_id") REFERENCES "printer_agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_print_job_attempts" ("created_at", "error_code", "error_message", "finished_at", "id", "print_job_id", "printer_agent_id", "started_at", "success") SELECT "created_at", "error_code", "error_message", "finished_at", "id", "print_job_id", "printer_agent_id", "started_at", "success" FROM "print_job_attempts";
DROP TABLE "print_job_attempts";
ALTER TABLE "new_print_job_attempts" RENAME TO "print_job_attempts";
CREATE TABLE "new_print_jobs" (
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "print_jobs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_print_jobs" ("attempt_count", "course_id", "created_at", "id", "idempotency_key", "label_course_name", "label_name", "max_attempts", "mode", "priority", "result_json", "status", "student_id", "target_printer_uid", "updated_at") SELECT "attempt_count", "course_id", "created_at", "id", "idempotency_key", "label_course_name", "label_name", "max_attempts", "mode", "priority", "result_json", "status", "student_id", "target_printer_uid", "updated_at" FROM "print_jobs";
DROP TABLE "print_jobs";
ALTER TABLE "new_print_jobs" RENAME TO "print_jobs";
CREATE UNIQUE INDEX "print_jobs_idempotency_key_key" ON "print_jobs"("idempotency_key");
CREATE INDEX "print_jobs_status_priority_created_at_idx" ON "print_jobs"("status", "priority", "created_at");
CREATE TABLE "new_printer_agents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agent_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'online',
    "version" TEXT,
    "metadata_json" TEXT,
    "last_seen_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_printer_agents" ("agent_key", "created_at", "id", "last_seen_at", "metadata_json", "name", "status", "updated_at", "version") SELECT "agent_key", "created_at", "id", "last_seen_at", "metadata_json", "name", "status", "updated_at", "version" FROM "printer_agents";
DROP TABLE "printer_agents";
ALTER TABLE "new_printer_agents" RENAME TO "printer_agents";
CREATE UNIQUE INDEX "printer_agents_agent_key_key" ON "printer_agents"("agent_key");
CREATE TABLE "new_printers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "printer_agent_id" INTEGER,
    "printer_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_online" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "printers_printer_agent_id_fkey" FOREIGN KEY ("printer_agent_id") REFERENCES "printer_agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_printers" ("created_at", "id", "is_default", "is_online", "last_seen_at", "name", "printer_agent_id", "printer_uid", "updated_at") SELECT "created_at", "id", "is_default", "is_online", "last_seen_at", "name", "printer_agent_id", "printer_uid", "updated_at" FROM "printers";
DROP TABLE "printers";
ALTER TABLE "new_printers" RENAME TO "printers";
CREATE UNIQUE INDEX "printers_printer_uid_key" ON "printers"("printer_uid");
CREATE TABLE "new_students" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "course_id" INTEGER NOT NULL,
    "course_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "document" TEXT,
    "token" TEXT NOT NULL,
    "ibc_customer_id" INTEGER,
    "checked_in" BOOLEAN NOT NULL DEFAULT false,
    "checked_in_at" DATETIME,
    "synced_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_students" ("checked_in", "checked_in_at", "course_id", "course_name", "ibc_customer_id", "id", "name", "synced_at", "token", "updated_at") SELECT "checked_in", "checked_in_at", "course_id", "course_name", "ibc_customer_id", "id", "name", "synced_at", "token", "updated_at" FROM "students";
DROP TABLE "students";
ALTER TABLE "new_students" RENAME TO "students";
CREATE UNIQUE INDEX "students_token_key" ON "students"("token");
CREATE INDEX "students_checked_in_idx" ON "students"("checked_in");
CREATE INDEX "students_name_idx" ON "students"("name");
CREATE INDEX "students_email_idx" ON "students"("email");
CREATE INDEX "students_document_idx" ON "students"("document");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
