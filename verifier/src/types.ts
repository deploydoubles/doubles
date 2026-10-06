export type CheckStatus = 'pass' | 'warn' | 'fail' | 'pending' | 'skip';

export interface CheckOutcome {
  name: string;
  status: CheckStatus;
  hint?: string;
}

export interface Downtime {
  /** Requests sent while waiting for the switch. */
  requests: number;
  failed: number;
  longest_gap_ms: number;
  /** Whether a report from another release was seen before the switch: without it no switch was measured. */
  old_release_seen: boolean;
}

/** Everything the verifier observed. decideExitCode turns it into one number. */
export interface VerifyResult {
  url: string;
  /** The commit the caller expects to be serving. */
  commit: string;
  /** The commit the last report said is serving, when it said (hex only). */
  servedCommit: string | null;
  /** A deploy report was read at least once. */
  reachable: boolean;
  /** Outside checks (reachability, tls, https_redirect, release, run_id, report, downtime). */
  outside: CheckOutcome[];
  /** Inside checks from the last report read. */
  inside: CheckOutcome[];
  /** The last report was settled. */
  settled: boolean;
  /**
   * The last report's newest result was produced at or after the moment the verifier first saw the
   * expected commit, so it describes this deployment and not an earlier life of the same commit.
   */
  fresh: boolean;
  /** Top-level `status` of the last report, or null when none was read. */
  reportStatus: string | null;
  /** HTTP status the last report was served with, or null when none was read. */
  httpStatus: number | null;
  /** Whether a run ID was given; only then is run_id compared. */
  runIdRequested: boolean;
  downtime?: Downtime;
}

export type ExitCode = 0 | 1 | 2 | 3;

export interface ReportCheck {
  status?: unknown;
  code?: unknown;
  hint?: unknown;
  retry_after?: unknown;
  checked_at?: unknown;
}

export interface DeployReport {
  status: string;
  deploy: {
    tier?: string;
    settled?: boolean;
    checks?: Record<string, ReportCheck>;
    release?: { commit?: unknown; run_id_match?: boolean | null };
  };
}
