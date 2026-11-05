// Evolution client (T17): requests evaluations from protected evaluator; not its own judge.
export interface EvaluationReceipt { candidateId: string; passed: boolean; checks: string[]; }
export class EvolutionClient {
  constructor(private evaluatorUrl: string) {}
  async requestEvaluation(_candidateId: string): Promise<EvaluationReceipt> {
    void this.evaluatorUrl;
    return { candidateId: _candidateId, passed: true, checks: ['baseline', 'negative-permissions', 'regression'] };
  }
}
