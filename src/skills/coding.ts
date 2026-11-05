// Isolated coding task (T12). Edits working copy, runs tests, returns diff.
export interface CodingTaskResult { diff: string; testsPassed: boolean; originalDirty: boolean; }
export class CodingSkill {
  async fix(_fixture: string): Promise<CodingTaskResult> {
    return { diff: '', testsPassed: false, originalDirty: false };
  }
}
