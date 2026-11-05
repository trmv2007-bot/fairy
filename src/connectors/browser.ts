// Research browser connector (T13). Replaceable search/fetch interface.
export interface BrowserConnector {
  search(q: string): Promise<{ title: string; url: string; snippet: string }[]>;
  fetch(url: string): Promise<{ text: string; title: string }>;
}
export class BrowserConnectorImpl implements BrowserConnector {
  async search(q: string): Promise<{ title: string; url: string; snippet: string }[]> {
    void q; return [];
  }
  async fetch(url: string): Promise<{ text: string; title: string }> {
    void url; return { text: '', title: '' };
  }
}
