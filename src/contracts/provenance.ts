export interface DataReference {
  source: string;
  capturedAt: number;
  sensitivity: 'public' | 'internal' | 'private' | 'secret';
  allowedDestinations: string[];
  allowedPurposes: string[];
  retentionDays?: number;
  derivationParents: string[];
  deleted: boolean;
}
