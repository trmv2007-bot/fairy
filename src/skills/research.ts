// Evidence-backed research (T13).
export interface ResearchResult { answer: string; sources: { title: string; url: string }[]; uncertainty: string; }
export class ResearchSkill {
  constructor(private browser: import('../connectors/browser.js').BrowserConnector) {}
  async run(question: string): Promise<ResearchResult> {
    const hits = await this.browser.search(question);
    const sources = hits.map(h => ({ title: h.title, url: h.url }));
    return { answer: '', sources, uncertainty: 'live fetch not yet wired' };
  }
}
