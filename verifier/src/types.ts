export type CheckStatus = 'pass' | 'warn' | 'fail' | 'pending' | 'skip';

export interface CheckOutcome {
  name: string;
  status: CheckStatus;
  hint?: string;
}

export interface Downtime {
  failed: number;
  longest_gap_ms: number;
}

/** Everything the verifier observed. decideExitCode turns it into one number. */
export interface VerifyResult {
  url: string;
  /** The commit the caller expects to be serving. */
  commit: string;
  /** The commit the last report said is serving, when it said. */
  servedCommit: string | null;
  /** A deploy report was read at least once. */
  reachable: boolean;
  /** Outside checks (reachability, tls, https_redirect, release, run_id, downtime). */
  outside: CheckOutcome[];
  /** Inside checks from the last report read. */
  inside: CheckOutcome[];
  /** The last report was settled. */
  settled: boolean;
  /** Whether a run ID was given; only then is run_id compared. */
  runIdRequested: boolean;
  downtime?: Downtime;
}

export type ExitCode = 0 | 1 | 2 | 3;

export interface ReportCheck {
  status?: unknown;
  hint?: unknown;
  retry_after?: unknown;
}

export interface DeployReport {
  status: string;
  deploy: {
    tier?: string;
    settled?: boolean;
    checks?: Record<string, ReportCheck>;
    release?: { commit?: string | null; run_id_match?: boolean | null };
  };
}
