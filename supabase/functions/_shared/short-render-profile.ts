/** Verify that a 9:16 render record describes the exact Drive artifact about to be used.
 * Profile metadata without a matching file id is stale and is never publishable.
 * Values are from ffprobe-verified output at completion, not inferred from filenames.
 */
export function isVerifiedCurrentShortRender(
  payload: unknown,
  currentDriveFileId: string | null | undefined,
): boolean {
  if (!payload || typeof payload !== "object" || !currentDriveFileId) return false;
  const p = payload as Record<string, unknown>;
  return String(p.drive_file_id ?? "") === currentDriveFileId &&
    p.render_profile === "youtube_short_9x16" &&
    Number(p.render_width) === 1080 &&
    Number(p.render_height) === 1920;
}
