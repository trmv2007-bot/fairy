import type { ModelGateway } from '../providers/gateway.js';
import type { BrowserConnector } from '../connectors/browser.js';

export interface ResearchResult { answer: string; sources: { title: string; url: string }[]; uncertainty: string; }
export class ResearchSkill {
  constructor(private browser: BrowserConnector, private gw: ModelGateway) {}
  async run(question: string): Promise<ResearchResult> {
    const p = this.gw.selectFor(['public'], false);
    const hits = await this.browser.search(question);
    const sources = hits.map(h => ({ title: h.title, url: h.url }));
    if (!p) return { answer: '', sources, uncertainty: 'no eligible cloud route; sources listed only' };
    // placeholder: real impl fetches + synthesizes with provenance inheritance
    void p;
    return { answer: '', sources, uncertainty: 'live synthesis not yet wired (T13)' };
  }
}
