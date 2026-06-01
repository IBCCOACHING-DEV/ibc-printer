-- Bootstrap schema for Printer Hub tables used by ibc-printer.
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS printer_agents (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(255) NOT NULL,
  agent_key VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'online',
  version VARCHAR(255) NULL,
  metadata_json JSON NULL,
  last_seen_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY index_printer_agents_on_agent_key (agent_key),
  KEY index_printer_agents_on_event_id_and_last_seen_at (event_id, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS printers (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(255) NOT NULL,
  printer_agent_id BIGINT NULL,
  printer_uid VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_online TINYINT(1) NOT NULL DEFAULT 1,
  capabilities_json JSON NULL,
  status_reason VARCHAR(255) NULL,
  last_seen_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY index_printers_on_printer_uid (printer_uid),
  KEY index_printers_on_event_id_and_is_online_and_last_seen_at (event_id, is_online, last_seen_at),
  KEY index_printers_on_printer_agent_id (printer_agent_id),
  CONSTRAINT fk_printers_printer_agents
    FOREIGN KEY (printer_agent_id) REFERENCES printer_agents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS print_jobs (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(255) NOT NULL,
  course_id BIGINT NULL,
  student_id BIGINT NULL,
  target_printer_uid VARCHAR(255) NOT NULL,
  payload_json JSON NOT NULL,
  mode VARCHAR(255) NOT NULL DEFAULT 'temporary',
  priority INT NOT NULL DEFAULT 0,
  status VARCHAR(255) NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  leased_by_agent_id BIGINT NULL,
  lease_expires_at DATETIME NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  result_json JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY index_print_jobs_on_idempotency_key (idempotency_key),
  KEY index_print_jobs_on_status_event_priority_created (status, event_id, priority, created_at),
  KEY index_print_jobs_on_target_printer_uid_and_status (target_printer_uid, status),
  KEY index_print_jobs_on_lease_expires_at_and_status (lease_expires_at, status),
  KEY index_print_jobs_on_leased_by_agent_id (leased_by_agent_id),
  KEY index_print_jobs_on_course_id (course_id),
  KEY index_print_jobs_on_student_id (student_id),
  CONSTRAINT fk_print_jobs_leased_by_agent
    FOREIGN KEY (leased_by_agent_id) REFERENCES printer_agents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS print_job_attempts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  print_job_id BIGINT NOT NULL,
  printer_agent_id BIGINT NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  success TINYINT(1) NOT NULL DEFAULT 0,
  error_code VARCHAR(255) NULL,
  error_message VARCHAR(255) NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY index_print_job_attempts_on_print_job_id (print_job_id),
  KEY index_print_job_attempts_on_printer_agent_id (printer_agent_id),
  CONSTRAINT fk_print_job_attempts_print_jobs
    FOREIGN KEY (print_job_id) REFERENCES print_jobs(id),
  CONSTRAINT fk_print_job_attempts_printer_agents
    FOREIGN KEY (printer_agent_id) REFERENCES printer_agents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
