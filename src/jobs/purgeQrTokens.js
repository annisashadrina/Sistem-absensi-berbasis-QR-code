import { getDb } from "../../db/index.js";
import config from "../config.js";

/**
 * Hapus token QR yang sudah kedaluwarsa lebih dari `retentionDays` hari.
 * Mengembalikan jumlah baris yang dihapus.
 */
export async function purgeExpiredQrTokens(
  retentionDays = config.qrTokenRetentionDays,
) {
  const db = await getDb();
  const result = await db.query(
    `DELETE FROM qr_tokens
     WHERE expires_at < CURRENT_TIMESTAMP - make_interval(days => $1::int)`,
    [retentionDays],
  );
  // PGlite memakai affectedRows, driver pg memakai rowCount.
  return result.affectedRows ?? result.rowCount ?? 0;
}

/**
 * Jalankan purge sekali saat start, lalu berulang tiap purgeIntervalHours.
 */
export function startPurgeJob() {
  const intervalMs = config.purgeIntervalHours * 60 * 60 * 1000;
  let running = false;

  const run = async () => {
    if (running) return; // cegah dua proses purge tumpang tindih
    running = true;
    try {
      const deleted = await purgeExpiredQrTokens();
      console.log(
        `[PURGE] ${deleted} token QR kedaluwarsa (> ${config.qrTokenRetentionDays} hari) dihapus.`,
      );
    } catch (error) {
      console.error("[PURGE_ERROR]", error.message);
    } finally {
      running = false;
    }
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref(); // timer tidak menahan proses saat shutdown
  return timer;
}
