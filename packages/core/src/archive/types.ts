export type Entries = Map<string, Uint8Array>;
export type Resources = Map<string, Uint8Array>;

export interface RawArchive {
  entries: Entries;
  resources: Resources;
}

export interface WriteReport {
  backup?: string;
  bytesWritten: number;
}
