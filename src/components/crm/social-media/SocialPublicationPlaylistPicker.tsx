import { useQuery } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { fetchSocialMediaSettings, type SocialPublication } from '@/lib/crm/social-media';

export function SocialPublicationPlaylistPicker({
  publication,
  onChange,
  disabled,
}: {
  publication: SocialPublication;
  onChange: (playlistIds: string[]) => void;
  disabled?: boolean;
}) {
  const { data: settings } = useQuery({ queryKey: ['social-media', 'settings'], queryFn: fetchSocialMediaSettings });
  const selectedIds = new Set(publication.playlists.map((playlist) => playlist.playlistId));
  const defaultIds = new Set(publication.playlists.filter((playlist) => playlist.isDefault).map((playlist) => playlist.playlistId));

  if (!settings) return null;

  return (
    <div className="space-y-2">
      <Label>Playlists</Label>
      <div className="space-y-1.5">
        {settings.playlists.map((playlist) => {
          const isDefault = defaultIds.has(playlist.id);
          const checked = selectedIds.has(playlist.id);
          return (
            <div key={playlist.id} className="flex items-center gap-2">
              <Checkbox
                id={`playlist-${playlist.id}`}
                checked={checked}
                disabled={disabled || isDefault}
                onCheckedChange={(value) => {
                  const next = new Set(selectedIds);
                  if (value) next.add(playlist.id); else next.delete(playlist.id);
                  onChange([...next]);
                }}
              />
              <Label htmlFor={`playlist-${playlist.id}`} className="text-sm font-normal flex items-center gap-2">
                {playlist.displayName}
                {isDefault && <Badge variant="secondary">Default</Badge>}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
