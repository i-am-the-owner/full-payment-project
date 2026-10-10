/** The status of one downstream dependency the service needs to be "ready". */
export interface DependencyStatus {
  readonly name: string;
  readonly status: 'up' | 'down';
  readonly latencyMs: number;
}

export interface ReadinessReport {
  readonly status: 'ready' | 'not_ready';
  readonly checks: readonly DependencyStatus[];
}
