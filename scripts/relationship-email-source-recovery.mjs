// Read-only provider verification. No Supabase writes or Gmail mutation endpoints.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function recoverOriginalSources(inventory, token, fetcher = fetch) {
  if (!token) throw new Error('GMAIL_READONLY_ACCESS_TOKEN is required.');
  if (!Array.isArray(inventory)) throw new Error('Expected the source recovery inventory array.');
  const get = async (path) => {
    let response;
    try {
      response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
      });
    } catch { return { status: 'UNAVAILABLE' }; }
    if (!response.ok) return { status: response.status === 404 ? 'NOT_FOUND' : response.status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE' };
    try { return { status: 'OK', data: await response.json() }; }
    catch { return { status: 'UNAVAILABLE' }; }
  };
  const profile = await get('profile');
  if (profile.status !== 'OK' || profile.data?.emailAddress?.toLowerCase() !== 'info@valorwell.org') {
    throw new Error(`Authoritative mailbox could not be verified (${profile.status}). No message checks performed.`);
  }
  const result = [];
  for (const issue of [...inventory].sort((a,b) => a.issueId.localeCompare(b.issueId))) {
    const source = await get(`messages/${encodeURIComponent(issue.claimedMessageId)}?format=metadata&metadataHeaders=Message-ID`);
    const message = source.data;
    const rfcValues = (message?.payload?.headers ?? []).filter(h => h.name.toLowerCase() === 'message-id').map(h => h.value);
    const storedRfc = issue.evidence?.storedRfcIds ?? [];
    const mismatch = source.status === 'OK' && (message?.id !== issue.claimedMessageId ||
      (issue.threadId && message.threadId !== issue.threadId) || new Set(rfcValues).size > 1 ||
      storedRfc.some(rfc => !rfcValues.includes(rfc)));
    const exact = source.status === 'OK' && !mismatch;
    const rfcSearches = [];
    if (!exact) for (const rfc of [...new Set(storedRfc)].sort()) {
      const lookup = await get(`messages?q=${encodeURIComponent(`in:anywhere rfc822msgid:${rfc}`)}&maxResults=100`);
      rfcSearches.push({ rfc, status: lookup.status, candidateIds: (lookup.data?.messages ?? []).map(m => m.id).sort(), truncated: Boolean(lookup.data?.nextPageToken) });
    }
    result.push({ ...issue, exactIdentityVerified: exact,
      // This command verifies identity, not CRM association eligibility.
      safelyRepairable: false,
      sourceStatus: mismatch ? 'MISMATCH' : exact ? 'VERIFIED_EXACT_PROVIDER_ID' : source.status,
      sourceCheck: 'Authenticated info@valorwell.org Gmail messages.get metadata; read-only',
      sourceLabels: message?.labelIds ?? [], verifiedRfcIds: exact ? rfcValues : [], rfcSearches,
      reason: exact ? 'Exact identity retrieved. Run the database repair preview for independent association gates; draft identity never proves a send.' :
        'Original identity unverified. RFC search results are candidates only; later messages must remain separate. Absence does not prove deletion or non-delivery.',
      providerRetrievalRequired: !exact,
    });
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node scripts/relationship-email-source-recovery.mjs inventory.json report.json');
  const report = await recoverOriginalSources(JSON.parse(await readFile(input, 'utf8')), process.env.GMAIL_READONLY_ACCESS_TOKEN);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`${report.length} checked; ${report.filter(r => r.exactIdentityVerified).length} exact identities verified. No records changed.`);
}
