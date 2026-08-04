// How long until a printer/agent without a heartbeat is considered stale and marked offline.
export const STALE_HEARTBEAT_THRESHOLD_SECONDS = 120; // 2 minutes

// How long until a printer is considered inactive and its status reason is updated.
export const HARD_INACTIVE_THRESHOLD_SECONDS = 300; // 5 minutes

// How long to keep successful temporary jobs before cleaning them up.
export const TEMPORARY_JOB_CLEANUP_THRESHOLD_SECONDS = 3600; // 1 hour