// Evolution client (T17): requests evaluations from the protected evaluator; not its own judge.
// FAIL CLOSED, mirroring native/Fairy.Evaluator/UpgradeGate: if the evaluator is
// unreachable, times out, or replies with anything malformed, the candidate is NOT
// approved. A stub returning `passed: true` would let every candidate self-approve —
// the exact attack the fail-closed gate exists to prevent.
export interface EvaluationReceipt { candidateId: string; passed: boolean; checks: string[]; }

const EVALUATOR_TIMEOUT_MS = 15_000;

export class EvolutionClient {
  constructor(private evaluatorUrl: string) {}

  async requestEvaluation(candidateId: string): Promise<EvaluationReceipt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EVALUATOR_TIMEOUT_MS);
    try {
      const base = this.evaluatorUrl.endsWith('/') ? this.evaluatorUrl : this.evaluatorUrl + '/';
      const res = await fetch(new URL('evaluate', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { candidateId, passed: false, checks: [`evaluator-http-${res.status}`] };
      }
      return parseReceipt(candidateId, await res.json());
    } catch {
      // unreachable / timeout / network error — fail closed, never approve by default
      return { candidateId, passed: false, checks: ['evaluator-unreachable'] };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseReceipt(candidateId: string, body: unknown): EvaluationReceipt {
  if (!body || typeof body !== 'object') {
    return { candidateId, passed: false, checks: ['evaluator-malformed-response'] };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.passed !== 'boolean') {
    return { candidateId, passed: false, checks: ['evaluator-malformed-response'] };
  }
  const checks = Array.isArray(b.checks)
    ? b.checks.filter((c): c is string => typeof c === 'string')
    : [];
  return { candidateId, passed: b.passed, checks };
}
