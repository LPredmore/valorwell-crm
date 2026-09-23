/** Fail-closed YouTube Shorts media check used by both CRM approval and upload worker.
 * YouTube chooses Shorts based on the actual MP4 dimensions/duration, not clip_type.
 * Drive videoMediaMetadata is populated asynchronously. If unavailable, do not
 * approve or upload: retry after processing rather than guessing.
 */
export type VideoGeometry = {
  width?: string | number | null;
  height?: string | number | null;
  durationMillis?: string | number | null;
};

export function shortsGeometryIssue(geometry: VideoGeometry | null | undefined): string | null {
  const width = Number(geometry?.width);
  const height = Number(geometry?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "The rendered video's dimensions are not available from Google Drive yet. Retry once processing completes; Shorts require square or vertical media.";
  }
  if (width > height) {
    return `This file is ${width}x${height} (landscape). Re-render the actual video to 9:16 (for example 720x1280) and replace the clip's Drive file before publishing as a Short.`;
  }
  const duration = geometry?.durationMillis;
  if (duration !== undefined && duration !== null) {
    const millis = Number(duration);
    if (!Number.isFinite(millis) || millis <= 0) {
      return "Google Drive returned an invalid video duration. Wait until the file finishes processing.";
    }
    if (millis > 180000) {
      return `This file is ${(millis / 1000).toFixed(1)} seconds long. YouTube Shorts must be 180 seconds or less.`;
    }
  }
  return null;
}
