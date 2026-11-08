import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getConfig } from "../src/lib/config";
import { logger } from "../src/lib/logger";

export function runBackup(customSourceDbPath?: string, customBackupDir?: string): string {
  const config = getConfig();
  const sourceDbPath = customSourceDbPath || config.DB_PATH;
  const backupDir = customBackupDir || path.resolve(process.cwd(), "backups");

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFilename = `trickle_backup_${timestamp}.db`;
  const targetBackupPath = path.resolve(backupDir, backupFilename);

  logger.info(`Starting SQLite VACUUM INTO backup from ${sourceDbPath} to ${targetBackupPath}`);

  const db = new Database(sourceDbPath, { readonly: false });
  try {
    db.prepare("VACUUM INTO ?").run(targetBackupPath);
    logger.info(`Backup completed successfully: ${targetBackupPath}`);
  } finally {
    db.close();
  }

  return targetBackupPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  try {
    const backupPath = runBackup();
    console.log(`Backup saved to: ${backupPath}`);
  } catch (err) {
    console.error("Backup failed:", err);
    process.exit(1);
  }
}
