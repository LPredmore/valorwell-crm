import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CreatorCommunityInterestDetail from '@/pages/crm/canonical/CreatorCommunityInterestDetail';
import type { InterestRecord } from '@/lib/crm/creator-community-interest';

const mutation = { isPending: false, mutateAsync: vi.fn() };
const access = { canMutate: false };
const detail: InterestRecord = {
  contact: { id: 'contact-1', tenantId: 'tenant-a', firstName: 'Jordan', lastName: 'Lee', preferredName: null, email: 'jordan@example.test', phone: '555-0100', state: 'IL', veteranAffiliation: 'veteran', outreachStatus: 'reviewing', reviewState: 'direct_outreach', ownerProfileId: null, nextAction: null, nextActionDueAt: null, lastContactAt: null, doNotContact: false, source: 'valorwell_website_interest', sourceRecordKey: 'source-1', metadata: { campaign: 'bty' }, createdAt: '2026-07-18T00:00:00Z', updatedAt: '2026-07-18T00:00:00Z' },
  profile: { contactId: 'contact-1', motivation: 'Serve others', veteranConnection: 'Army veteran', willingToShare: true, comfortLevel: 'public_story', fundraisingGoal: '$5,000', additionalInfo: 'Available weekends', acceptedRules: true, highestFollowerPlatform: 'YouTube', highestFollowerCount: 4000, personalMission: 'Normalize care', avatarUrl: null, profileComplete: true, pastCompetitions: [{ name: 'Fundraiser' }], isCompeting: true, status: 'active', source: 'website', sourceRecordKey: 'profile-source-1', metadata: {} },
  roles: [{ roleCode: 'creator', source: 'website', metadata: {} }, { roleCode: 'clinician', source: 'credentialing', metadata: {} }],
  socials: [{ id: 'social-1', platformName: 'YouTube', handle: '@jordan', profileUrl: 'https://example.test/jordan', followerCount: 4000, approved: true, source: 'website', metadata: {} }],
  submissions: [{ id: 'submission-1', submissionType: 'interest_submission', normalizedLane: 'creator', originalLane: 'creator', sourceSystem: 'valorwell_website_interest', sourcePage: '/beyondtheyellow', status: 'received', payload: { mission: 'Normalize care' }, submittedAt: '2026-07-18T00:00:00Z' }],
  notes: [{ id: 'note-1', noteContent: 'Called and left a message.', noteType: 'internal', isPinned: false, createdByProfileId: 'profile-1', createdAt: '2026-07-18T01:00:00Z' }], owner: null,
};

vi.mock('@/hooks/crm/useCreatorCommunityInterest', () => ({
  useCreatorCommunityInterestDetail: () => ({ data: { record: detail, owners: [] }, isPending: false, error: null }),
  useInterestMutations: () => ({ canMutate: access.canMutate, updateRecord: mutation, addRole: mutation, removeRole: mutation, addNote: mutation }),
}));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

describe('CreatorCommunityInterestDetail', () => {
  beforeEach(() => {
    access.canMutate = false;
    mutation.mutateAsync.mockReset();
    mutation.mutateAsync.mockResolvedValue(undefined);
  });

  function renderDetail() {
    return render(<MemoryRouter initialEntries={['/crm/creator-community-interest/contact-1']}><Routes><Route path="/crm/creator-community-interest/:id" element={<CreatorCommunityInterestDetail />} /></Routes></MemoryRouter>);
  }

  it('shows full canonical, social, source, competition, and interaction detail in read-only mode', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Jordan Lee' })).toBeInTheDocument();
    expect(screen.getByText('Read-only access')).toBeInTheDocument();
    expect(screen.getByText(/Army veteran/)).toBeInTheDocument();
    expect(screen.getByText(/@jordan/)).toBeInTheDocument();
    expect(screen.getByText(/Called and left a message/)).toBeInTheDocument();
    expect(screen.getByText(/Fundraiser/)).toBeInTheDocument();
    expect(screen.getAllByText(/valorwell_website_interest/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Save corrections' })).not.toBeInTheDocument();
  });

  it('constrains corrections to the atomic RPC contract', () => {
    access.canMutate = true;
    renderDetail();

    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Email')).toHaveAttribute('maxlength', '254');
    expect(screen.getByLabelText('First name')).toHaveAttribute('maxlength', '100');
    expect(screen.getByLabelText('Phone')).toHaveAttribute('maxlength', '40');
    expect(screen.getByLabelText('State or territory')).toHaveValue('IL');
    expect(screen.getByRole('option', { name: 'AP' })).toBeInTheDocument();
    expect(screen.getByLabelText('Comfort level')).toHaveValue('public_story');
    expect(screen.getByRole('option', { name: 'Behind The Scenes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Personal mission')).toHaveAttribute('maxlength', '4000');
    expect(screen.getByLabelText('Additional information')).toHaveAttribute('maxlength', '8000');
    expect(screen.getByLabelText('Next action')).toHaveAttribute('maxlength', '1000');
  });

  it('keeps non-interest roles read-only and selects the first remaining interest role', async () => {
    access.canMutate = true;
    renderDetail();

    expect(screen.getByRole('button', { name: 'Remove Creator role' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Clinician role' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role to add')).toHaveValue('bty_promoter');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mutation.mutateAsync).toHaveBeenCalledWith('bty_promoter'));
  });

  it('atomically synchronizes do-not-contact when outreach status changes', async () => {
    access.canMutate = true;
    renderDetail();

    fireEvent.change(screen.getByLabelText('Outreach status'), { target: { value: 'do_not_contact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save workflow' }));
    await waitFor(() => expect(mutation.mutateAsync).toHaveBeenLastCalledWith({
      contactChanges: expect.objectContaining({
        outreach_status: 'do_not_contact',
        do_not_contact: true,
      }),
    }));

    fireEvent.change(screen.getByLabelText('Outreach status'), { target: { value: 'engaged' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save workflow' }));
    await waitFor(() => expect(mutation.mutateAsync).toHaveBeenLastCalledWith({
      contactChanges: expect.objectContaining({
        outreach_status: 'engaged',
        do_not_contact: false,
      }),
    }));
  });
});
