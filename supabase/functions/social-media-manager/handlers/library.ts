import type { AuthContext } from "../auth.ts";
import type { ContentFormat, SocialMediaLibraryItem, SocialPublicationSummary } from "../types.ts";

export type LibraryFilters = {
  format?: "all" | "short" | "long_form" | "full_episode";
  search?: string;
  guest?: string;
  organization?: string;
  readiness?: "all" | "ready" | "not_ready";
  publicationState?: "all" | "unscheduled" | "scheduled" | "published" | "failed";
};

type ClipRow = {
  id: string;
  project_id: string;
  clip_type: string;
  youtube_title: string | null;
  youtube_description: string | null;
  cover_image_file_id: string | null;
  cover_image_url: string | null;
  start_seconds: number;
  end_seconds: number;
  drive_file_id: string | null;
  drive_file_url: string | null;
  status: string;
  ai_operations_video_projects: {
    id: string;
    guest_name: string | null;
    organization_name: string | null;
  } | null;
};

type ProjectRow = {
  id: string;
  guest_name: string | null;
  organization_name: string | null;
  duration_seconds: number | null;
  source_file_id: string | null;
  source_web_url: string | null;
  source_file_name: string | null;
  status: string;
  cover_image_file_id: string | null;
  cover_image_url: string | null;
};

type PublicationRow = {
  id: string;
  status: string;
  delivery_mode: string;
  scheduled_for: string | null;
  desired_privacy_status: string;
  external_video_id: string | null;
  external_url: string | null;
  clip_id: string | null;
  project_id: string;
  content_format: string;
};

const TERMINAL_STATUSES = new Set(["failed", "cancelled"]);

function summarize(row: PublicationRow): SocialPublicationSummary {
  return {
    id: row.id,
    status: row.status as SocialPublicationSummary["status"],
    deliveryMode: row.delivery_mode as SocialPublicationSummary["deliveryMode"],
    scheduledFor: row.scheduled_for,
    desiredPrivacyStatus: row.desired_privacy_status as SocialPublicationSummary["desiredPrivacyStatus"],
    externalVideoId: row.external_video_id,
    externalUrl: row.external_url,
  };
}

export async function listLibrary(auth: AuthContext, filters: LibraryFilters = {}): Promise<SocialMediaLibraryItem[]> {
  const { db, tenantId } = auth;

  const [{ data: clips, error: clipsError }, { data: projects, error: projectsError }, { data: publications, error: pubError }] =
    await Promise.all([
      db.from("ai_operations_video_clips")
        .select(`
          id, project_id, clip_type, youtube_title, youtube_description,
          cover_image_file_id, cover_image_url, start_seconds, end_seconds,
          drive_file_id, drive_file_url, status,
          ai_operations_video_projects!inner(id, guest_name, organization_name, tenant_id)
        `)
        .eq("ai_operations_video_projects.tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("ai_operations_video_projects")
        .select("id, guest_name, organization_name, duration_seconds, source_file_id, source_web_url, source_file_name, status, cover_image_file_id, cover_image_url")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("ai_operations_social_publications")
        .select("id, status, delivery_mode, scheduled_for, desired_privacy_status, external_video_id, external_url, clip_id, project_id, content_format")
        .eq("tenant_id", tenantId),
    ]);

  if (clipsError) throw new Error(clipsError.message);
  if (projectsError) throw new Error(projectsError.message);
  if (pubError) throw new Error(pubError.message);

  const pubsByClip = new Map<string, PublicationRow[]>();
  const pubsByProject = new Map<string, PublicationRow[]>();
  for (const pub of (publications ?? []) as PublicationRow[]) {
    if (pub.clip_id) {
      const list = pubsByClip.get(pub.clip_id) ?? [];
      list.push(pub);
      pubsByClip.set(pub.clip_id, list);
    } else if (pub.content_format === "full_episode") {
      const list = pubsByProject.get(pub.project_id) ?? [];
      list.push(pub);
      pubsByProject.set(pub.project_id, list);
    }
  }
  const pickPublications = (rows: PublicationRow[] | undefined) => {
    if (!rows?.length) return { active: null, published: null };
    const sorted = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1));
    const active = sorted.find((row) => !TERMINAL_STATUSES.has(row.status) && row.status !== "published") ?? null;
    const published = sorted.find((row) => row.status === "published") ?? null;
    return { active: active ? summarize(active) : null, published: published ? summarize(published) : null };
  };

  const items: SocialMediaLibraryItem[] = [];

  for (const clip of (clips ?? []) as unknown as ClipRow[]) {
    const contentFormat: ContentFormat = clip.clip_type === "short" ? "short" : "long_form";
    const project = clip.ai_operations_video_projects;
    const { active, published } = pickPublications(pubsByClip.get(clip.id));
    const readinessReasons: string[] = [];
    if (!clip.drive_file_id) readinessReasons.push("Rendered clip is not yet available in Drive.");
    if (clip.status !== "rendered") readinessReasons.push(`Clip status is "${clip.status}", not rendered.`);

    items.push({
      sourceType: "clip",
      sourceId: clip.id,
      projectId: clip.project_id,
      clipId: clip.id,
      contentFormat,
      title: clip.youtube_title,
      description: clip.youtube_description,
      // cover_image_url is a Drive /file/d/<id>/view page on a PRIVATE file -- never image
      // bytes, so it must not be handed to an <img>. The browser asks get_thumbnail_url for a
      // short-lived signed URL against the server-side cache instead.
      thumbnailUrl: null,
      thumbnailFileId: clip.cover_image_file_id,
      guestName: project?.guest_name ?? null,
      organizationName: project?.organization_name ?? null,
      durationSeconds: Number(clip.end_seconds) - Number(clip.start_seconds),
      sourceFileId: clip.drive_file_id,
      sourceFileUrl: clip.drive_file_url,
      readiness: { ready: readinessReasons.length === 0, reasons: readinessReasons },
      activePublication: active,
      publishedPublication: published,
      defaultPlaylistName: contentFormat === "short" ? "BTY Shorts" : "Beyond The Yellow - Parts",
    });
  }

  for (const project of (projects ?? []) as ProjectRow[]) {
    const { active, published } = pickPublications(pubsByProject.get(project.id));
    const readinessReasons: string[] = [];
    if (!project.source_file_id) readinessReasons.push("Source video file is not available.");

    items.push({
      sourceType: "project",
      sourceId: project.id,
      projectId: project.id,
      clipId: null,
      contentFormat: "full_episode",
      title: null,
      description: null,
      // Full episodes show ONLY an explicitly configured episode cover. The guest portrait field is a
      // guest portrait, not cover art, and is deliberately not used as a fallback: a project
      // without cover_image_file_id renders a blank neutral thumbnail area.
      thumbnailUrl: null,
      thumbnailFileId: project.cover_image_file_id,
      guestName: project.guest_name,
      organizationName: project.organization_name,
      durationSeconds: project.duration_seconds,
      sourceFileId: project.source_file_id,
      sourceFileUrl: project.source_web_url,
      readiness: { ready: readinessReasons.length === 0, reasons: readinessReasons },
      activePublication: active,
      publishedPublication: published,
      defaultPlaylistName: "Beyond The Yellow - Full Episodes",
    });
  }

  return applyFilters(items, filters);
}

function applyFilters(items: SocialMediaLibraryItem[], filters: LibraryFilters): SocialMediaLibraryItem[] {
  let result = items;

  if (filters.format && filters.format !== "all") {
    result = result.filter((item) => item.contentFormat === filters.format);
  }
  if (filters.search) {
    const needle = filters.search.trim().toLowerCase();
    if (needle) {
      result = result.filter((item) =>
        (item.title ?? "").toLowerCase().includes(needle) ||
        (item.guestName ?? "").toLowerCase().includes(needle) ||
        (item.organizationName ?? "").toLowerCase().includes(needle));
    }
  }
  if (filters.guest) {
    result = result.filter((item) => item.guestName === filters.guest);
  }
  if (filters.organization) {
    result = result.filter((item) => item.organizationName === filters.organization);
  }
  if (filters.readiness && filters.readiness !== "all") {
    result = result.filter((item) => (filters.readiness === "ready" ? item.readiness.ready : !item.readiness.ready));
  }
  if (filters.publicationState && filters.publicationState !== "all") {
    result = result.filter((item) => {
      const state = filters.publicationState;
      if (state === "unscheduled") return !item.activePublication && !item.publishedPublication;
      if (state === "scheduled") return item.activePublication?.status === "scheduled";
      if (state === "published") return Boolean(item.publishedPublication);
      if (state === "failed") return item.activePublication?.status === "failed";
      return true;
    });
  }

  return result;
}
