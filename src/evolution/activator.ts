// Idle activation + probation + rollback (T18).
export interface ActivatorDeps {
  resourceGovernor: { canRunHeavy(): boolean; acquireHeavy(): boolean; releaseHeavy(): void };
  recovery: { rollbackLastGood(): number };
}
export class Activator {
  constructor(private deps: ActivatorDeps) {}
  canActivateNow(activeDesktopControl: boolean, pendingApproval: boolean, voiceActive: boolean): boolean {
    if (activeDesktopControl || pendingApproval || voiceActive) return false;
    return this.deps.resourceGovernor.canRunHeavy();
  }
  activate(candidateId: string): { ok: boolean; reason?: string } {
    if (!this.deps.resourceGovernor.acquireHeavy()) return { ok: false, reason: 'heavy job running' };
    try {
      // stage + switch + health check (placeholder)
      void candidateId;
      return { ok: true };
    } finally {
      this.deps.resourceGovernor.releaseHeavy();
    }
  }
  rollback(): number { return this.deps.recovery.rollbackLastGood(); }
}
