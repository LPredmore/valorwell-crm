import type {
  CrmDataProvider, Paged, ListClientsQuery, ListTasksQuery,
} from '../types';
import type { CanonicalClient, LifecycleStage } from '@/domain/canonical';
import type { CrmTask, TaskStatus, OperationalException, Campaign, CampaignEnrollment, CommunicationMessage, StaffMember, AuditEvent, CommunicationPolicyResult } from '@/domain/operations';
import { mockClients, mockCampaigns, mockEnrollments, mockTasks, mockExceptions, mockStaff, mockAudit, mockMessages } from '@/mocks/dataset';
import { unavailableRelationshipsRepository } from '../relationships-unavailable';
import { buildTaskViewPlan, sortTasksForViewPlan, taskMatchesViewPlan } from '../taskViewSemantics';

// In-memory mutable stores so mock mutations feel real across the session.
let clients: CanonicalClient[] = [...mockClients];
let tasks: CrmTask[] = [...mockTasks];
const exceptions: OperationalException[] = [...mockExceptions];
let campaigns: Campaign[] = [...mockCampaigns];
let enrollments: CampaignEnrollment[] = [...mockEnrollments];
let messages: CommunicationMessage[] = [...mockMessages];

const listeners = new Set<() => void>();
function emit() { listeners.forEach(fn => fn()); }
export function subscribeMockChanges(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); }

const wait = (ms = 120) => new Promise(r => setTimeout(r, ms));

function matchClient(c: CanonicalClient, q: ListClientsQuery): boolean {
  if (q.search) {
    const s = q.search.toLowerCase();
    const hay = `${c.legalFirstName} ${c.legalLastName} ${c.preferredName ?? ''} ${c.email ?? ''} ${c.phone ?? ''} ${c.id}`.toLowerCase();
    if (!hay.includes(s)) return false;
  }
  if (q.lifecycle?.length && !q.lifecycle.includes(c.lifecycle)) return false;
  if (q.engagement?.length && !q.engagement.includes(c.engagement)) return false;
  if (q.eligibility?.length && !q.eligibility.includes(c.eligibility)) return false;
  if (q.contactPolicy?.length && !q.contactPolicy.includes(c.contactPolicy)) return false;
  if (q.servicePolicy?.length && !q.servicePolicy.includes(c.servicePolicy)) return false;
  if (q.atRisk !== undefined && c.risk.atRisk !== q.atRisk) return false;
  if (q.assignedClinicianIds?.length && (!c.assignedClinicianId || !q.assignedClinicianIds.includes(c.assignedClinicianId))) return false;
  if (q.states?.length && (!c.state || !q.states.includes(c.state))) return false;
  return true;
}

function patch(tenantId: string, id: string, mut: (c: CanonicalClient) => CanonicalClient): CanonicalClient {
  const idx = clients.findIndex(c => c.id === id && c.tenantId === tenantId);
  if (idx === -1) throw new Error('Client not found in current operating tenant');
  const next = { ...mut(clients[idx]), updatedAt: new Date().toISOString() };
  clients = [...clients.slice(0, idx), next, ...clients.slice(idx + 1)];
  emit();
  return next;
}

export const mockDataProvider: CrmDataProvider = {
  relationships: unavailableRelationshipsRepository,
  clients: {
    async list(tenantId, q: ListClientsQuery): Promise<Paged<CanonicalClient>> {
      await wait();
      const filtered = clients.filter(c => c.tenantId === tenantId && matchClient(c, q));
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? 50;
      const sortBy = q.sortBy ?? 'updatedAt';
      const dir = q.sortDir === 'asc' ? 1 : -1;
      const sorted = [...filtered].sort((a, b) => {
        const av = (a[sortBy] ?? '') as string;
        const bv = (b[sortBy] ?? '') as string;
        return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
      });
      const start = (page - 1) * pageSize;
      return { rows: sorted.slice(start, start + pageSize), total: filtered.length, page, pageSize };
    },
    async get(tenantId, id) { await wait(60); return clients.find(c => c.id === id && c.tenantId === tenantId) ?? null; },
    async updateLifecycle(tenantId, id, next, reason) { return patch(tenantId, id, c => ({ ...c, lifecycle: next as LifecycleStage, nextRequiredAction: reason ? undefined : c.nextRequiredAction })); },
    async updateEngagement(tenantId, id, next) { return patch(tenantId, id, c => ({ ...c, engagement: next })); },
    async updateEligibility(tenantId, id, next) { return patch(tenantId, id, c => ({ ...c, eligibility: next })); },
    async updateContactPolicy(tenantId, id, next) { return patch(tenantId, id, c => ({ ...c, contactPolicy: next })); },
    async updateServicePolicy(tenantId, id, next) { return patch(tenantId, id, c => ({ ...c, servicePolicy: next })); },
    async updateCareCadence(tenantId, id, next) { return patch(tenantId, id, c => ({ ...c, careCadence: next })); },
    async updateRisk(tenantId, id, next) { return patch(tenantId, id, c => ({ ...c, risk: next })); },
    async close(tenantId, id, info) { return patch(tenantId, id, c => ({ ...c, lifecycle: 'Closed', closure: info })); },
    async reopen(tenantId, id) { return patch(tenantId, id, c => ({ ...c, lifecycle: 'Intake', closure: undefined })); },
    async assignClinician(tenantId, id, staffId, _reason) { if (!staffId?.trim()) throw new Error('assignClinician: staffId is required'); return patch(tenantId, id, c => ({ ...c, assignedClinicianId: staffId })); },
    async assignOperationsOwner(tenantId, id, staffId) { return patch(tenantId, id, c => ({ ...c, assignedOperationsOwnerId: staffId ?? undefined })); },
  },

  tasks: {
    async list(q: ListTasksQuery) {
      await wait();
      const plan = buildTaskViewPlan(q);
      const filtered = tasks.filter((t) => {
        if (!taskMatchesViewPlan(t, plan)) return false;
        if (q.clientId && t.clientId !== q.clientId) return false;
        if (q.ownerIds?.length && (!t.ownerId || !q.ownerIds.includes(t.ownerId))) return false;
        if (q.statuses?.length && !q.statuses.includes(t.status)) return false;
        if (q.dueBefore && (!t.dueAt || new Date(t.dueAt).getTime() > new Date(q.dueBefore).getTime())) return false;
        if (q.dueAfter && (!t.dueAt || new Date(t.dueAt).getTime() < new Date(q.dueAfter).getTime())) return false;
        if (q.types?.length && !q.types.includes(t.type)) return false;
        if (q.search) {
          const s = q.search.toLowerCase();
          if (!`${t.title} ${t.description ?? ''}`.toLowerCase().includes(s)) return false;
        }
        return true;
      });
      return sortTasksForViewPlan(filtered, plan);
    },
    async get(tenantId, id) { await wait(30); return tasks.find(t => t.id === id && t.tenantId === tenantId) ?? null; },
    async create(tenantId, input) {
      await wait();
      if (input.tenantId !== tenantId) throw new Error('Task does not belong to the current CRM operating tenant');
      const t: CrmTask = { ...input, id: `task-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      tasks = [t, ...tasks]; emit(); return t;
    },
    async update(tenantId, id, p) {
      await wait();
      const idx = tasks.findIndex(t => t.id === id && t.tenantId === tenantId); if (idx === -1) throw new Error('Task not found');
      tasks[idx] = { ...tasks[idx], ...p, updatedAt: new Date().toISOString() }; emit(); return tasks[idx];
    },
    async complete(tenantId, id) {
      return this.update(tenantId, id, { status: 'Completed', completedAt: new Date().toISOString() });
    },
    async reassign(tenantId, ids, ownerId) { await wait(); tasks = tasks.map(t => t.tenantId === tenantId && ids.includes(t.id) ? { ...t, ownerId } : t); emit(); },
    async bulkStatus(tenantId, ids, status: TaskStatus) { await wait(); tasks = tasks.map(t => t.tenantId === tenantId && ids.includes(t.id) ? { ...t, status } : t); emit(); },
    async bulkDueDate(tenantId, ids, dueAt) { await wait(); tasks = tasks.map(t => t.tenantId === tenantId && ids.includes(t.id) ? { ...t, dueAt } : t); emit(); },
  },

  exceptions: {
    async list(tenantId, q) {
      await wait();
      return exceptions.filter(e => {
        if (e.tenantId !== tenantId) return false;
        if (q?.status?.length && !q.status.includes(e.status)) return false;
        if (q?.ownerId && e.ownerId !== q.ownerId) return false;
        if (q?.clientId && e.clientId !== q.clientId) return false;
        return true;
      });
    },
    async get(tenantId, id) { return exceptions.find(e => e.id === id && e.tenantId === tenantId) ?? null; },
    async resolve(tenantId, id, note) {
      await wait();
      const idx = exceptions.findIndex(e => e.id === id && e.tenantId === tenantId); if (idx === -1) throw new Error();
      exceptions[idx] = { ...exceptions[idx], status: 'Resolved', lastActivityAt: new Date().toISOString(),
        resolutionHistory: [...exceptions[idx].resolutionHistory, { at: new Date().toISOString(), action: 'resolved', note }] };
      emit(); return exceptions[idx];
    },
    async dismiss(tenantId, id, note) {
      await wait();
      const idx = exceptions.findIndex(e => e.id === id && e.tenantId === tenantId); if (idx === -1) throw new Error();
      exceptions[idx] = { ...exceptions[idx], status: 'Dismissed', lastActivityAt: new Date().toISOString(),
        resolutionHistory: [...exceptions[idx].resolutionHistory, { at: new Date().toISOString(), action: 'dismissed', note }] };
      emit(); return exceptions[idx];
    },
    async reassign(tenantId, id, ownerId) {
      await wait();
      const idx = exceptions.findIndex(e => e.id === id && e.tenantId === tenantId); if (idx === -1) throw new Error();
      exceptions[idx] = { ...exceptions[idx], ownerId, lastActivityAt: new Date().toISOString() };
      emit(); return exceptions[idx];
    },
    async createTaskFromException(tenantId, id) {
      const e = exceptions.find(x => x.id === id && x.tenantId === tenantId); if (!e) throw new Error();
      return mockDataProvider.tasks.create(tenantId, {
        tenantId: e.tenantId,
        title: `Resolve: ${e.type}`, description: e.summary, clientId: e.clientId, exceptionId: e.id,
        type: 'Campaign Exception', priority: e.severity === 'Critical' ? 'Urgent' : 'High',
        status: 'Not Started', ownerId: e.ownerId, collaboratorIds: [], createdByProfileId: 'system',
        checklist: [], tags: [],
      });
    },
  },

  campaigns: {
    async list(tenantId) { await wait(); return campaigns.filter(c => c.tenantId === tenantId); },
    async get(tenantId, id) { return campaigns.find(c => c.id === id && c.tenantId === tenantId) ?? null; },
    async create(tenantId, input) {
      await wait();
      if (input.tenantId !== tenantId) throw new Error('Campaign does not belong to the current CRM operating tenant');
      const c: Campaign = { ...input, id: `camp-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        metrics: { enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0 } };
      campaigns = [c, ...campaigns]; emit(); return c;
    },
    async update(tenantId, id, p) {
      await wait();
      const idx = campaigns.findIndex(c => c.id === id && c.tenantId === tenantId); if (idx === -1) throw new Error();
      campaigns[idx] = { ...campaigns[idx], ...p, updatedAt: new Date().toISOString() }; emit(); return campaigns[idx];
    },
    async enrollments(tenantId, campaignId) {
      await wait();
      if (!campaigns.some(c => c.id === campaignId && c.tenantId === tenantId)) return [];
      return enrollments.filter(e => e.campaignId === campaignId);
    },
    async enroll(tenantId, campaignId, clientIds) {
      await wait();
      if (!campaigns.some(c => c.id === campaignId && c.tenantId === tenantId)) throw new Error('Campaign not found in current operating tenant');
      if (clientIds.some(id => !clients.some(c => c.id === id && c.tenantId === tenantId))) throw new Error('One or more clients do not belong to the current operating tenant');
      const created: CampaignEnrollment[] = clientIds.map(cid => ({
        id: `enr-${Date.now()}-${cid}`, campaignId, clientId: cid, status: 'Active',
        currentStepId: 's1', startedAt: new Date().toISOString(), completedSteps: [],
      }));
      enrollments = [...created, ...enrollments];
      clients = clients.map(c => clientIds.includes(c.id) ? { ...c, activeCampaignId: campaignId } : c);
      emit(); return created;
    },
    async pauseEnrollment(tenantId, id, _reason) { const i = enrollments.findIndex(e => e.id === id && campaigns.some(c => c.id === e.campaignId && c.tenantId === tenantId)); if (i === -1) throw new Error(); enrollments[i] = { ...enrollments[i], status: 'Paused' }; emit(); return enrollments[i]; },
    async resumeEnrollment(tenantId, id, _reason) { const i = enrollments.findIndex(e => e.id === id && campaigns.some(c => c.id === e.campaignId && c.tenantId === tenantId)); if (i === -1) throw new Error(); enrollments[i] = { ...enrollments[i], status: 'Active' }; emit(); return enrollments[i]; },
    async cancelEnrollment(tenantId, id, reason) { const i = enrollments.findIndex(e => e.id === id && campaigns.some(c => c.id === e.campaignId && c.tenantId === tenantId)); if (i === -1) throw new Error(); enrollments[i] = { ...enrollments[i], status: 'Canceled', exitReason: reason }; emit(); return enrollments[i]; },
    async restartEnrollment(tenantId, id, _reason) { const i = enrollments.findIndex(e => e.id === id && campaigns.some(c => c.id === e.campaignId && c.tenantId === tenantId)); if (i === -1) throw new Error(); enrollments[i] = { ...enrollments[i], status: 'Active', currentStepId: 's1', completedSteps: [] }; emit(); return enrollments[i]; },
  },

  communications: {
    async listForClient(tenantId, clientId) { await wait(); return messages.filter(m => m.tenantId === tenantId && m.clientId === clientId).sort((a,b) => a.createdAt.localeCompare(b.createdAt)); },
    async listThreads(tenantId, channel) {
      await wait();
      const byThread = new Map<string, CommunicationMessage>();
      messages.filter(m => m.tenantId === tenantId && m.channel === channel).forEach(m => {
        const existing = byThread.get(m.threadId);
        if (!existing || existing.createdAt < m.createdAt) byThread.set(m.threadId, m);
      });
      return Array.from(byThread.values()).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    },
    async send(tenantId, msg) {
      await wait();
      if (msg.tenantId !== tenantId) throw new Error('Communication does not belong to the current CRM operating tenant');
      const policy = await mockDataProvider.communications.evaluatePolicy(tenantId, {
        clientId: msg.clientId!, channel: msg.channel as 'sms'|'email',
        campaignId: msg.campaignId, messageClass: 'necessary_scheduling',
      });
      const status: CommunicationMessage['status'] = policy.allowed ? 'sent' : 'suppressed';
      const created: CommunicationMessage = { ...msg, id: `msg-${Date.now()}`, createdAt: new Date().toISOString(), status,
        suppressionReason: policy.allowed ? undefined : policy.reasons.join('; ') };
      messages = [created, ...messages]; emit(); return created;
    },
    async evaluatePolicy(tenantId, { clientId, channel, messageClass }): Promise<CommunicationPolicyResult> {
      const c = clients.find(x => x.id === clientId && x.tenantId === tenantId);
      if (!c) return { allowed: false, requiresReview: false, reasons: ['Client not found'] };
      const reasons: string[] = [];
      let code: CommunicationPolicyResult['suppressionCode'] | undefined;
      const isCritical = messageClass === 'clinical_safety_legal' || messageClass === 'billing_insurance' || messageClass === 'transactional_account';
      if (c.contactPolicy === 'Do Not Contact' && !isCritical) { reasons.push('Client marked Do Not Contact'); code = 'contact_policy_dnc'; }
      if (c.servicePolicy === 'Service Blocked' && messageClass === 'ordinary_campaign_follow_up') { reasons.push('Service Blocked — campaign follow-up not permitted'); code = code ?? 'service_policy_blocked'; }
      if (c.lifecycle === 'Closed' && messageClass === 'ordinary_campaign_follow_up') { reasons.push('Client is closed'); code = code ?? 'lifecycle_closed_no_active_care'; }
      if (channel === 'sms' && !c.phone) { reasons.push('No phone on file'); code = code ?? 'class_never_permitted'; }
      if (channel === 'email' && !c.email) { reasons.push('No email on file'); code = code ?? 'class_never_permitted'; }
      return { allowed: reasons.length === 0, requiresReview: false, reasons, suppressionCode: code };
    },
    async ingestInbound(tenantId, msg) {
      await wait();
      if (msg.tenantId !== tenantId) throw new Error('Communication does not belong to the current CRM operating tenant');
      const created: CommunicationMessage = { ...msg, tenantId, id: `msg-${Date.now()}`, createdAt: new Date().toISOString(), status: 'received' };
      messages = [created, ...messages];
      // REMOVE / STOP detection
      const opt = /^\s*(stop|remove|unsubscribe|quit|end|cancel)\s*$/i.test(msg.body);
      if (opt && msg.clientId) {
        patch(tenantId, msg.clientId, c => ({ ...c, contactPolicy: 'Do Not Contact' }));
        enrollments = enrollments.map(e => e.clientId === msg.clientId && e.status === 'Active'
          ? { ...e, status: 'Canceled', exitReason: 'Client opted out via inbound keyword' } : e);
      }
      emit(); return created;
    },
  },

  staff: {
    async list(tenantId) { await wait(); return mockStaff.filter(s => s.tenantId === tenantId); },
    async get(tenantId, id) { return mockStaff.find(s => s.id === id && s.tenantId === tenantId) ?? null; },
  },

  audit: {
    async listForClient(tenantId, clientId) { await wait(); return (mockAudit[clientId] ?? []).filter(event => event.tenantId === tenantId); },
  },

  reports: {
    async journeyFunnel(tenantId) {
      await wait();
      return {
        tenantId,
        bucketStart: '2026-07-06',
        bucketEnd: '2026-07-13',
        rows: [
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', stage: 'registration', entered_count: 18, exited_count: 12, current_count: 24, median_days_in_stage: 3 },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', stage: 'intake', entered_count: 12, exited_count: 8, current_count: 16, median_days_in_stage: 6 },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', stage: 'matching', entered_count: 8, exited_count: 5, current_count: 11, median_days_in_stage: 9 },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', stage: 'scheduled', entered_count: 5, exited_count: 3, current_count: 8, median_days_in_stage: 4 },
        ],
      };
    },

    async engagementMetrics(tenantId) {
      await wait();
      return {
        tenantId,
        bucketStart: '2026-07-06',
        bucketEnd: '2026-07-13',
        rows: [
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', engagement: 'normal', current_count: 48, entered_count: 14, avg_days_to_normal: 0 },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', engagement: 'unresponsive_warm', current_count: 9, entered_count: 4, avg_days_to_normal: null },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', engagement: 'unresponsive_cold', current_count: 5, entered_count: 2, avg_days_to_normal: null },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', engagement: 'went_dark', current_count: 3, entered_count: 1, avg_days_to_normal: null },
        ],
      };
    },

    async closureMetrics(tenantId) {
      await wait();
      return {
        tenantId,
        bucketStart: '2026-07-06',
        bucketEnd: '2026-07-13',
        rows: [
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', disposition_reason: 'completed_care', closed_count: 6, reopened_count: 1, net_closed: 5 },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', disposition_reason: 'other', closed_count: 3, reopened_count: 0, net_closed: 3 },
        ],
      };
    },

    async campaignPerformance(tenantId) {
      await wait();
      return {
        tenantId,
        bucketStart: '2026-07-06',
        bucketEnd: '2026-07-13',
        rows: [
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', campaign_id: 'camp-1', campaignName: 'Welcome Campaign', enrolled_count: 30, completed_count: 18, cancelled_count: 2, responded_count: 11, suppressed_count: 3, failed_count: 1 },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', campaign_id: 'camp-2', campaignName: 'Care Follow-Up', enrolled_count: 22, completed_count: 12, cancelled_count: 1, responded_count: 7, suppressed_count: 2, failed_count: 0 },
        ],
      };
    },

    async taskPerformance(tenantId) {
      await wait();
      return {
        tenantId,
        bucketStart: '2026-07-06',
        bucketEnd: '2026-07-13',
        rows: [
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', assignee_id: 'profile-1', assigneeName: 'Morgan Lee', open_count: 7, completed_count: 12, overdue_count: 2, median_hours_to_complete: 18 },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', assignee_id: null, assigneeName: 'Unassigned', open_count: 3, completed_count: 1, overdue_count: 1, median_hours_to_complete: 24 },
        ],
      };
    },

    async exceptionMetrics(tenantId) {
      await wait();
      return {
        tenantId,
        bucketStart: '2026-07-06',
        bucketEnd: '2026-07-13',
        rows: [
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', exception_type: 'communication_suppressed', raised_count: 8, resolved_count: 6, open_count: 2, median_hours_to_resolve: 14 },
          { tenant_id: tenantId, bucket_start: '2026-07-06', bucket_end: '2026-07-13', exception_type: 'eligibility_verification_failed', raised_count: 5, resolved_count: 3, open_count: 2, median_hours_to_resolve: 20 },
        ],
      };
    },
  },
};
