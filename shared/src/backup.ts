// The Hub's nightly backup: a copy of its database and clips, kept on the NAS (see hub/src/backup.ts),
// and a second copy somewhere that isn't the NAS: a disk on the box, or an rclone remote.

export interface BackupFile {
  name: string;
  at: number;
  bytes: number;
}

/** The second copy: where it goes, what it keeps, and how the last one went. */
export interface BackupOffsite {
  /** A path on a disk the Hub can see, or an rclone remote (which can be encrypted). */
  kind: "dir" | "rclone";
  /** The folder or the remote:path, as the Hub sees it. */
  target: string;
  /** The newest copy of each of the last few days. */
  keepDays: number;
  /** Then one a week before that. */
  keepWeeks: number;
  /** The copy that went across with the last good backup. */
  last?: BackupFile;
  /** The last copy that didn't go across, when it's newer than the last one that did. */
  error?: { at: number; message: string };
  /** What's there, newest first: listed at the destination, not remembered. */
  files: BackupFile[];
  /** Why the second copy can't run at all, such as rclone not being installed. */
  problem?: string;
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
  /** The second copy, when one is set up (BACKUP_OFFSITE…). */
  offsite?: BackupOffsite;
}
