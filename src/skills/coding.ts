import type { ModelGateway } from '../providers/gateway.js';

export interface CodingTaskResult { diff: string; testsPassed: boolean; originalDirty: boolean; summary: string; }
export class CodingSkill {
  constructor(private gw: ModelGateway) {}
  async fix(fixture: string, failingTest: string): Promise<CodingTaskResult> {
    const p = this.gw.selectFor(['internal'], false);
    if (!p) return { diff: '', testsPassed: false, originalDirty: false, summary: 'no eligible cloud route (blocked)' };
    // placeholder: real impl reads fixture, asks model, applies patch in isolated worktree, runs tests
    void fixture; void failingTest; void p;
    return { diff: '', testsPassed: false, originalDirty: false, summary: 'live coding not yet wired to worker (T12)' };
  }
}
