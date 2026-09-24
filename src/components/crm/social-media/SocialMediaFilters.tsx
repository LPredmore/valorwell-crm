import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LibraryFilters } from '@/lib/crm/social-media';

const ANY = '__any__';

export function SocialMediaFilters({
  filters,
  onChange,
  guests = [],
  organizations = [],
}: {
  filters: LibraryFilters;
  onChange: (next: LibraryFilters) => void;
  guests?: string[];
  organizations?: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search title, guest, organization..."
        className="w-64"
        value={filters.search ?? ''}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
      />
      <Select value={filters.format ?? 'all'} onValueChange={(value) => onChange({ ...filters, format: value as LibraryFilters['format'] })}>
        <SelectTrigger className="w-40"><SelectValue placeholder="Format" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="short">Shorts</SelectItem>
          <SelectItem value="long_form">Long Form</SelectItem>
          <SelectItem value="full_episode">Full Episodes</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.guest ?? ANY} onValueChange={(value) => onChange({ ...filters, guest: value === ANY ? undefined : value })}>
        <SelectTrigger className="w-44" aria-label="Guest"><SelectValue placeholder="Guest" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All guests</SelectItem>
          {guests.map((guest) => <SelectItem key={guest} value={guest}>{guest}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.organization ?? ANY} onValueChange={(value) => onChange({ ...filters, organization: value === ANY ? undefined : value })}>
        <SelectTrigger className="w-48" aria-label="Organization"><SelectValue placeholder="Organization" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All organizations</SelectItem>
          {organizations.map((organization) => <SelectItem key={organization} value={organization}>{organization}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.readiness ?? 'all'} onValueChange={(value) => onChange({ ...filters, readiness: value as LibraryFilters['readiness'] })}>
        <SelectTrigger className="w-36"><SelectValue placeholder="Readiness" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Ready / Not Ready</SelectItem>
          <SelectItem value="ready">Ready</SelectItem>
          <SelectItem value="not_ready">Not Ready</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.publicationState ?? 'all'}
        onValueChange={(value) => onChange({ ...filters, publicationState: value as LibraryFilters['publicationState'] })}
      >
        <SelectTrigger className="w-44"><SelectValue placeholder="Publication state" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any state</SelectItem>
          <SelectItem value="unscheduled">Unscheduled</SelectItem>
          <SelectItem value="scheduled">Scheduled</SelectItem>
          <SelectItem value="published">Published</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
