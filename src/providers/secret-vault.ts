// In-memory secret vault (main process only).
// Secrets entered in the Settings panel are held here for the current app session and
// are NEVER written to disk (fairy-config.json stores only opaque handle strings).
// Long-term home is the native broker's CredentialHost (T05, DPAPI-backed); this vault
// is the interim store that enforces the "no raw secrets on disk" contract today.
export class SecretVault {
  private secrets = new Map<string, string>();

  store(handle: string, secret: string): void {
    if (handle.length === 0) throw new Error('vault: handle must be non-empty');
    if (secret.length === 0) throw new Error('vault: secret must be non-empty');
    this.secrets.set(handle, secret);
  }

  resolve(handle: string): string | undefined {
    return this.secrets.get(handle);
  }

  remove(handle: string): void {
    this.secrets.delete(handle);
  }

  clear(): void {
    this.secrets.clear();
  }

  size(): number {
    return this.secrets.size;
  }
}
