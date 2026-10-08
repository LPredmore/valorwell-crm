import { Navigate, useLocation, useParams } from 'react-router-dom';

interface CrmLegacyRouteRedirectProps {
  /** Explicit canonical route. :id and other named segments are preserved. */
  to: string;
}

/**
 * Compatibility-only router element. Preserves legacy bookmarks, campaign/contact
 * identifiers, query filters, and hash fragments without replacing specialized pages.
 * React Router handles the redirect after authentication at the existing /crm layout.
 */
export function CrmLegacyRouteRedirect({ to }: CrmLegacyRouteRedirectProps) {
  const params = useParams();
  const location = useLocation();
  const pathname = to.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, (_, key: string) =>
    encodeURIComponent(params[key] ?? ''),
  );
  return <Navigate replace to={{ pathname, search: location.search, hash: location.hash }} />;
}
