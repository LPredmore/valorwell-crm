import type {
  CrmDataProvider, Paged, ListClientsQuery, ListTasksQuery,
} from '../types';
import type { CanonicalClient, LifecycleStage } from '@/domain/canonical';
import type { CrmTask, TaskStatus, OperationalException, Campaign, CampaignEnrollment, CommunicationMessage, StaffMember, AuditEvent, CommunicationPolicyResult } from '@/domain/operations';
import { mockClients, mockCampaigns, mockEnrollments, mockTasks, mockExceptions, mockStaff, mockAudit, mockMessages } from '@/mocks/dataset';

// In-memory mutable stores so mock mutations feel real across the session.
let clients: CanonicalClient[] = [...mockClients];
let tasks: CrmTask[] = [...mockTasks];
let exceptions: OperationalException[] = [...mockExceptions];
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
  if (q.assignedOperationsOwnerIds?.length && (!c.assignedOperationsOwnerId || !q.assignedOperationsOwnerIds.includes(c.assignedOperationsOwnerId))) return false;
  if (q.states?.length && (!c.state || !q.states.includes(c.state))) return false;
  if (q.payers?.length && (!c.payer || !q.payers.includes(c.payer))) return false;
  if (q.campaignIds?.length && (!c.activeCampaignId || !q.campaignIds.includes(c.activeCampaignId))) return false;
  if (q.tags?.length && !q.tags.some(t => c.tags.includes(t))) return false;
  if (q.hasOpenTasks && c.openTaskCount === 0) return false;
  return true;
}

function patch(id: string, mut: (c: CanonicalClient) => CanonicalClient): CanonicalClient {
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('Client not found');
  const next = { ...mut(clients[idx]), updatedAt: new Date().toISOString() };
  clients = [...clients.slice(0, idx), next, ...clients.slice(idx + 1)];
  emit();
  return next;
}

export const mockDataProvider: CrmDataProvider = {
  clients: {
    async list(q: ListClientsQuery): Promise<Paged<CanonicalClient>> {
      await wait();
      const filtered = clients.filter(c => matchClient(c, q));
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
    async get(id) { await wait(60); return clients.find(c => c.id === id) ?? null; },
    async updateLifecycle(id, next, reason) { return patch(id, c => ({ ...c, lifecycle: next as LifecycleStage, nextRequiredAction: reason ? undefined : c.nextRequiredAction })); },
    async updateEngagement(id, next) { return patch(id, c => ({ ...c, engagement: next })); },
    async updateEligibility(id, next) { return patch(id, c => ({ ...c, eligibility: next })); },
    async updateContactPolicy(id, next) { return patch(id, c => ({ ...c, contactPolicy: next })); },
    async updateServicePolicy(id, next) { return patch(id, c => ({ ...c, servicePolicy: next })); },
    async updateCareCadence(id, next) { return patch(id, c => ({ ...c, careCadence: next })); },
    async updateRisk(id, next) { return patch(id, c => ({ ...c, risk: next })); },
    async close(id, info) { return patch(id, c => ({ ...c, lifecycle: 'Closed', closure: info })); },
    async reopen(id) { return patch(id, c => ({ ...c, lifecycle: 'Intake', closure: undefined })); },
    async assignClinician(id, staffId) { return patch(id, c => ({ ...c, assignedClinicianId: staffId ?? undefined })); },
    async assignOperationsOwner(id, staffId) { return patch(id, c => ({ ...c, assignedOperationsOwnerId: staffId ?? undefined })); },
  },

  tasks: {
    async list(q: ListTasksQuery) {
      await wait();
      const now = Date.now();
      return tasks.filter(t => {
        if (q.clientId && t.clientId !== q.clientId) return false;
        if (q.ownerIds?.length && (!t.ownerId || !q.ownerIds.includes(t.ownerId))) return false;
        if (q.statuses?.length && !q.statuses.includes(t.status)) return false;
        if (q.search) {
          const s = q.search.toLowerCase();
          if (!`${t.title} ${t.description ?? ''}`.toLowerCase().includes(s)) return false;
        }
        if (q.view === 'overdue') return t.status !== 'Completed' && t.status !== 'Canceled' && t.dueAt && new Date(t.dueAt).getTime() < now;
        if (q.view === 'due-today') { if (!t.dueAt) return false; const d = new Date(t.dueAt); const today = new Date(); return d.toDateString() === today.toDateString(); }
        if (q.view === 'unassigned') return !t.ownerId;
        if (q.view === 'recently-completed') return t.status === 'Completed';
        return true;
      });
    },
    async get(id) { await wait(30); return tasks.find(t => t.id === id) ?? null; },
    async create(input) {
      await wait();
      const t: CrmTask = { ...input, id: `task-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      tasks = [t, ...tasks]; emit(); return t;
    },
    async update(id, p) {
      await wait();
      const idx = tasks.findIndex(t => t.id === id); if (idx === -1) throw new Error('Task not found');
      tasks[idx] = { ...tasks[idx], ...p, updatedAt: new Date().toISOString() }; emit(); return tasks[idx];
    },
    async complete(id) {
      return this.update(id, { status: 'Completed', completedAt: new Date().toISOString() });
    },
    async reassign(ids, ownerId) { await wait(); tasks = tasks.map(t => ids.includes(t.id) ? { ...t, ownerId } : t); emit(); },
    async bulkStatus(ids, status: TaskStatus) { await wait(); tasks = tasks.map(t => ids.includes(t.id) ? { ...t, status } : t); emit(); },
    async bulkDueDate(ids, dueAt) { await wait(); tasks = tasks.map(t => ids.includes(t.id) ? { ...t, dueAt } : t); emit(); },
  },

  exceptions: {
    async list(q) {
      await wait();
      return exceptions.filter(e => {
        if (q?.status?.length && !q.status.includes(e.status)) return false;
        if (q?.ownerId && e.ownerId !== q.ownerId) return false;
        if (q?.clientId && e.clientId !== q.clientId) return false;
        return true;
      });
    },
    async get(id) { return exceptions.find(e => e.id === id) ?? null; },
    async resolve(id, note) {
      await wait();
      const idx = exceptions.findIndex(e => e.id === id); if (idx === -1) throw new Error();
      exceptions[idx] = { ...exceptions[idx], status: 'Resolved', lastActivityAt: new Date().toISOString(),
        resolutionHistory: [...exceptions[idx].resolutionHistory, { at: new Date().toISOString(), action: 'resolved', note }] };
      emit(); return exceptions[idx];
    },
    async dismiss(id, note) {
      await wait();
      const idx = exceptions.findIndex(e => e.id === id); if (idx === -1) throw new Error();
      exceptions[idx] = { ...exceptions[idx], status: 'Dismissed', lastActivityAt: new Date().toISOString(),
        resolutionHistory: [...exceptions[idx].resolutionHistory, { at: new Date().toISOString(), action: 'dismissed', note }] };
      emit(); return exceptions[idx];
    },
    async reassign(id, ownerId) {
      await wait();
      const idx = exceptions.findIndex(e => e.id === id); if (idx === -1) throw new Error();
      exceptions[idx] = { ...exceptions[idx], ownerId, lastActivityAt: new Date().toISOString() };
      emit(); return exceptions[idx];
    },
    async createTaskFromException(id) {
      const e = exceptions.find(x => x.id === id); if (!e) throw new Error();
      return mockDataProvider.tasks.create({
        title: `Resolve: ${e.type}`, description: e.summary, clientId: e.clientId, exceptionId: e.id,
        type: 'Campaign Exception', priority: e.severity === 'Critical' ? 'Urgent' : 'High',
        status: 'Not Started', ownerId: e.ownerId, collaboratorIds: [], createdByProfileId: 'system',
        checklist: [], tags: [],
      });
    },
  },

  campaigns: {
    async list() { await wait(); return campaigns; },
    async get(id) { return campaigns.find(c => c.id === id) ?? null; },
    async create(input) {
      await wait();
      const c: Campaign = { ...input, id: `camp-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        metrics: { enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0 } };
      campaigns = [c, ...campaigns]; emit(); return c;
    },
    async update(id, p) {
      await wait();
      const idx = campaigns.findIndex(c => c.id === id); if (idx === -1) throw new Error();
      campaigns[idx] = { ...campaigns[idx], ...p, updatedAt: new Date().toISOString() }; emit(); return campaigns[idx];
    },
    async enrollments(campaignId) { await wait(); return enrollments.filter(e => e.campaignId === campaignId); },
    async enroll(campaignId, clientIds) {
      await wait();
      const created: CampaignEnrollment[] = clientIds.map(cid => ({
        id: `enr-${Date.now()}-${cid}`, campaignId, clientId: cid, status: 'Active',
        currentStepId: 's1', startedAt: new Date().toISOString(), completedSteps: [],
      }));
      enrollments = [...created, ...enrollments];
      clients = clients.map(c => clientIds.includes(c.id) ? { ...c, activeCampaignId: campaignId } : c);
      emit(); return created;
    },
    async pauseEnrollment(id) { const i = enrollments.findIndex(e => e.id === id); enrollments[i] = { ...enrollments[i], status: 'Paused' }; emit(); return enrollments[i]; },
    async resumeEnrollment(id) { const i = enrollments.findIndex(e => e.id === id); enrollments[i] = { ...enrollments[i], status: 'Active' }; emit(); return enrollments[i]; },
    async cancelEnrollment(id, reason) { const i = enrollments.findIndex(e => e.id === id); enrollments[i] = { ...enrollments[i], status: 'Canceled', exitReason: reason }; emit(); return enrollments[i]; },
    async restartEnrollment(id) { const i = enrollments.findIndex(e => e.id === id); enrollments[i] = { ...enrollments[i], status: 'Active', currentStepId: 's1', completedSteps: [] }; emit(); return enrollments[i]; },
  },

  communications: {
    async listForClient(clientId) { await wait(); return messages.filter(m => m.clientId === clientId).sort((a,b) => a.createdAt.localeCompare(b.createdAt)); },
    async listThreads(channel) {
      await wait();
      const byThread = new Map<string, CommunicationMessage>();
      messages.filter(m => m.channel === channel).forEach(m => {
        const existing = byThread.get(m.threadId);
        if (!existing || existing.createdAt < m.createdAt) byThread.set(m.threadId, m);
      });
      return Array.from(byThread.values()).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    },
    async send(msg) {
      await wait();
      const policy = await mockDataProvider.communications.evaluatePolicy({
        clientId: msg.clientId!, channel: msg.channel as 'sms'|'email',
        campaignId: msg.campaignId, messageClass: 'manual',
      });
      const status: CommunicationMessage['status'] = policy.allowed ? 'sent' : 'suppressed';
      const created: CommunicationMessage = { ...msg, id: `msg-${Date.now()}`, createdAt: new Date().toISOString(), status,
        suppressionReason: policy.allowed ? undefined : policy.reasons.join('; ') };
      messages = [created, ...messages]; emit(); return created;
    },
    async evaluatePolicy({ clientId, channel, messageClass }): Promise<CommunicationPolicyResult> {
      const c = clients.find(x => x.id === clientId);
      if (!c) return { allowed: false, requiresReview: false, reasons: ['Client not found'] };
      const reasons: string[] = [];
      let code: CommunicationPolicyResult['suppressionCode'] | undefined;
      if (c.contactPolicy === 'Do Not Contact' && messageClass !== 'critical_operational') { reasons.push('Client marked Do Not Contact'); code = 'DO_NOT_CONTACT'; }
      if (c.servicePolicy === 'Service Blocked' && messageClass === 'ordinary_campaign_follow_up') { reasons.push('Service Blocked — campaign follow-up not permitted'); code = code ?? 'SERVICE_BLOCKED'; }
      if (c.lifecycle === 'Closed' && messageClass === 'ordinary_campaign_follow_up') { reasons.push('Client is closed'); code = code ?? 'CLIENT_CLOSED'; }
      if (channel === 'sms' && !c.phone) { reasons.push('No phone on file'); code = code ?? 'CHANNEL_RESTRICTED'; }
      if (channel === 'email' && !c.email) { reasons.push('No email on file'); code = code ?? 'CHANNEL_RESTRICTED'; }
      return { allowed: reasons.length === 0, requiresReview: false, reasons, suppressionCode: code };
    },
    async ingestInbound(msg) {
      await wait();
      const created: CommunicationMessage = { ...msg, id: `msg-${Date.now()}`, createdAt: new Date().toISOString(), status: 'received' };
      messages = [created, ...messages];
      // REMOVE / STOP detection
      const opt = /^\s*(stop|remove|unsubscribe|quit|end|cancel)\s*$/i.test(msg.body);
      if (opt && msg.clientId) {
        patch(msg.clientId, c => ({ ...c, contactPolicy: 'Do Not Contact' }));
        enrollments = enrollments.map(e => e.clientId === msg.clientId && e.status === 'Active'
          ? { ...e, status: 'Canceled', exitReason: 'Client opted out via inbound keyword' } : e);
      }
      emit(); return created;
    },
  },

  staff: {
    async list() { await wait(); return mockStaff; },
    async get(id) { return mockStaff.find(s => s.id === id) ?? null; },
  },

  audit: {
    async listForClient(clientId) { await wait(); return mockAudit[clientId] ?? []; },
  },

  reports: {
    async journeyFunnel() {
      await wait();
      const stages = ['Registration','Intake','Matching','Wait Path','Scheduled','Early Care','Established Care','Inactive','Closed'] as const;
      return stages.map(stage => ({
        stage, count: clients.filter(c => c.lifecycle === stage).length,
        medianDays: 3 + stages.indexOf(stage) * 4,
      }));
    },
    async atRiskMetrics() {
      await wait();
      const atRisk = clients.filter(c => c.risk.atRisk);
      return {
        totalAtRisk: atRisk.length, newlyAtRisk: Math.round(atRisk.length * 0.3),
        resolved: 12, averageDaysAtRisk: 8,
        byReason: [{ reason: 'Missed appointments', count: Math.round(atRisk.length * 0.6) }, { reason: 'No response', count: Math.round(atRisk.length * 0.4) }],
        byStage: [{ stage: 'Early Care', count: 3 }, { stage: 'Established Care', count: 2 }],
        overdueInterventions: 5,
      };
    },
    async engagementMetrics() {
      await wait();
      const counts = { Engaged: 0, Warm: 0, Cold: 0, 'Went Dark': 0 } as Record<'Engaged'|'Warm'|'Cold'|'Went Dark', number>;
      clients.forEach(c => { counts[c.engagement] += 1; });
      return { counts, reengagementRate: 0.24, medianDaysSinceLastContact: 6 };
    },
    async closureMetrics() {
      return [
        { reason: 'Completed Treatment Plan', count: 24 },
        { reason: 'Client Request', count: 11 },
        { reason: 'Insurance Termination', count: 6 },
        { reason: 'Lost Contact', count: 9 },
      ];
    },
    async campaignPerformance() {
      return campaigns.map(c => ({
        campaignId: c.id, name: c.name,
        enrolled: c.metrics.enrolled, sent: c.metrics.enrolled + 40, delivered: c.metrics.enrolled + 30,
        responded: Math.round(c.metrics.enrolled * c.metrics.responseRate),
        completed: c.metrics.completed, suppressed: c.metrics.suppressed, failed: c.metrics.failed,
        optedOut: Math.round(c.metrics.enrolled * 0.03),
      }));
    },
    async taskPerformance() {
      const open = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Canceled').length;
      const overdue = tasks.filter(t => t.dueAt && new Date(t.dueAt).getTime() < Date.now() && t.status !== 'Completed').length;
      const byOwnerMap = new Map<string, { open: number; overdue: number }>();
      tasks.forEach(t => {
        if (!t.ownerId) return;
        const rec = byOwnerMap.get(t.ownerId) ?? { open: 0, overdue: 0 };
        if (t.status !== 'Completed' && t.status !== 'Canceled') rec.open += 1;
        if (t.dueAt && new Date(t.dueAt).getTime() < Date.now() && t.status !== 'Completed') rec.overdue += 1;
        byOwnerMap.set(t.ownerId, rec);
      });
      return { open, overdue, avgCompletionHours: 18, byOwner: Array.from(byOwnerMap.entries()).map(([ownerId, v]) => ({ ownerId, ...v })) };
    },
    async exceptionMetrics() {
      const byType = new Map<string, number>();
      const bySev = new Map<string, number>();
      let open = 0, resolved = 0;
      exceptions.forEach(e => {
        byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
        bySev.set(e.severity, (bySev.get(e.severity) ?? 0) + 1);
        if (e.status === 'Open' || e.status === 'In Review') open += 1;
        if (e.status === 'Resolved') resolved += 1;
      });
      return {
        byType: Array.from(byType.entries()).map(([type, count]) => ({ type, count })),
        bySeverity: Array.from(bySev.entries()).map(([severity, count]) => ({ severity, count })),
        openVsResolved: { open, resolved }, avgResolutionHours: 14,
      };
    },
  },
};
