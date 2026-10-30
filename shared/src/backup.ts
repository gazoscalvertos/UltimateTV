// The Hub's nightly backup: a copy of its database and clips, kept on the NAS (see hub/src/backup.ts).

export interface BackupFile {
  name: string;
  at: number;
  bytes: number;
}

export interface BackupState {
  /** Off when BACKUP=off on the Hub. */
  enabled: boolean;
  /** Where the copies go, as the Hub sees it. */
  dir: string;
  /** False when the NAS isn't mounted in the Hub and the copies sit beside the Hub's own data. */
  onNas: boolean;
  /** How many are kept; older ones are deleted. */
  keep: number;
  /** When the nightly one runs, "03:30" (the Hub's time zone). */
  time: string;
  running: boolean;
  last?: BackupFile;
  /** The last attempt that failed, when it's newer than the last good one. */
  error?: { at: number; message: string };
  nextAt?: number;
  backups: BackupFile[];
}
