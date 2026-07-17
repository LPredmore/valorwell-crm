import type { CanonicalClient } from '@/domain/canonical';
import type { StaffMember, Campaign, CampaignEnrollment, CrmTask, OperationalException, CommunicationMessage, AuditEvent } from '@/domain/operations';

const TENANT = 'tenant-valorwell';

function iso(daysAgo: number, hoursAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(d.getHours() - hoursAgo);
  return d.toISOString();
}

export const mockStaff: StaffMember[] = [
  { id: 'staff-1', tenantId: TENANT, firstName: 'Ava', lastName: 'Chen', displayName: 'Ava Chen, LPC', role: 'clinician', status: 'Active', states: ['CA','OR','WA'], email: 'ava@valorwell.org', phone: '+15555550101', caseloadCount: 42, openTaskCount: 6, availability: 'Available', credentialsSummary: 'LPC · CA/OR/WA' },
  { id: 'staff-2', tenantId: TENANT, firstName: 'Marcus', lastName: 'Reed', displayName: 'Marcus Reed, LCSW', role: 'clinician', status: 'Active', states: ['TX','NM','AZ'], email: 'marcus@valorwell.org', caseloadCount: 51, openTaskCount: 11, availability: 'Full', credentialsSummary: 'LCSW · TX/NM/AZ' },
  { id: 'staff-3', tenantId: TENANT, firstName: 'Priya', lastName: 'Kapoor', displayName: 'Priya Kapoor, LMFT', role: 'clinician', status: 'Active', states: ['NY','NJ','CT'], email: 'priya@valorwell.org', caseloadCount: 38, openTaskCount: 4, availability: 'Available', credentialsSummary: 'LMFT · NY/NJ/CT' },
  { id: 'staff-4', tenantId: TENANT, firstName: 'Jordan', lastName: 'Blake', displayName: 'Jordan Blake', role: 'operations', status: 'Active', states: [], email: 'jordan@valorwell.org', caseloadCount: 0, openTaskCount: 14, availability: 'Available' },
  { id: 'staff-5', tenantId: TENANT, firstName: 'Sam', lastName: 'Ortiz', displayName: 'Sam Ortiz', role: 'operations', status: 'Active', states: [], email: 'sam@valorwell.org', caseloadCount: 0, openTaskCount: 9, availability: 'Available' },
  { id: 'staff-6', tenantId: TENANT, firstName: 'Dr. Elena', lastName: 'Voss', displayName: 'Dr. Elena Voss', role: 'admin', status: 'Active', states: [], email: 'elena@valorwell.org', caseloadCount: 0, openTaskCount: 2, availability: 'Available' },
];

const FIRST = ['James','Mary','Robert','Patricia','John','Linda','Michael','Barbara','William','Elizabeth','David','Jennifer','Richard','Maria','Joseph','Susan','Thomas','Jessica','Charles','Sarah','Christopher','Karen','Daniel','Nancy','Matthew','Lisa','Anthony','Betty','Mark','Sandra','Donald','Ashley','Steven','Kimberly','Paul','Emily','Andrew','Donna','Joshua','Michelle'];
const LAST = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin'];
const STATES = ['CA','TX','NY','FL','IL','PA','OH','GA','NC','MI','NJ','VA','WA','AZ','MA','TN','IN','MO','MD','WI'];
const PAYERS = ['TRICARE','VA CCN','BCBS','United','Aetna','Cigna','Self-pay','Kaiser'];

const LIFECYCLES: CanonicalClient['lifecycle'][] = ['Registration','Intake','Matching','Matched','Scheduled','Early Care','Established Care','Closed'];
const ENGAGEMENTS: CanonicalClient['engagement'][] = ['Engaged','Warm','Cold','Went Dark'];
const ELIG: CanonicalClient['eligibility'][] = ['Eligible','Coverage Issue','Manual Review','Unknown'];

function rand<T>(arr: readonly T[], i: number): T { return arr[i % arr.length]; }

function makeClient(i: number): CanonicalClient {
  const first = rand(FIRST, i * 7);
  const last = rand(LAST, i * 3);
  const lifecycle = rand(LIFECYCLES, i);
  const engagement = rand(ENGAGEMENTS, i * 2);
  const eligibility = rand(ELIG, i * 5);
  const isDnc = i % 17 === 0;
  const isBlocked = i % 23 === 0;
  const atRisk = i % 11 === 0;
  const clinician = rand(['staff-1','staff-2','staff-3'], i);
  const ops = rand(['staff-4','staff-5'], i);
  return {
    id: `client-${i.toString().padStart(4, '0')}`,
    tenantId: TENANT,
    legalFirstName: first,
    legalLastName: last,
    preferredName: i % 5 === 0 ? first.slice(0,3) : undefined,
    pronouns: i % 4 === 0 ? 'they/them' : i % 2 === 0 ? 'she/her' : 'he/him',
    dateOfBirth: `19${60 + (i % 40)}-0${1 + (i % 9)}-1${i % 9}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
    phone: `+1555${(1000000 + i).toString().slice(-7)}`,
    state: rand(STATES, i),
    assignedClinicianId: lifecycle === 'Registration' || lifecycle === 'Intake' ? undefined : clinician,
    assignedOperationsOwnerId: ops,
    lifecycle,
    engagement,
    eligibility,
    contactPolicy: isDnc ? 'Do Not Contact' : 'Contact Allowed',
    servicePolicy: isBlocked ? 'Service Blocked' : 'Service Allowed',
    careCadence: lifecycle === 'Established Care' || lifecycle === 'Early Care' ? 'Regular' : 'As Needed',
    risk: atRisk
      ? { atRisk: true, atRiskSince: iso(i % 30), reasons: ['Missed 2 consecutive appointments'], severity: i % 3 === 0 ? 'High' : 'Moderate', lastEvaluatedAt: iso(1), requiredNextAction: 'Clinician outreach within 48h', ownerId: clinician }
      : { atRisk: false, reasons: [] },
    closure: lifecycle === 'Closed'
      ? { closureReason: 'Completed Care', dispositionReason: 'Graduated', closedAt: iso(i % 60), reentryAllowed: true }
      : undefined,
    payer: rand(PAYERS, i),
    program: i % 3 === 0 ? 'Veterans Program' : 'Standard',
    lastContactAt: iso(i % 45),
    lastContactChannel: i % 3 === 0 ? 'email' : i % 3 === 1 ? 'sms' : 'phone',
    lastContactDirection: i % 4 === 0 ? 'inbound' : 'outbound',
    nextAppointmentAt: lifecycle === 'Scheduled' || lifecycle === 'Early Care' || lifecycle === 'Established Care' ? iso(-(1 + i % 14)) : undefined,
    nextRequiredAction: atRisk ? 'Risk outreach' : lifecycle === 'Matching' ? 'Assign clinician' : undefined,
    activeCampaignId: i % 6 === 0 ? 'camp-1' : i % 7 === 0 ? 'camp-2' : undefined,
    openTaskCount: (i % 5),
    tags: i % 8 === 0 ? ['veteran','priority'] : i % 3 === 0 ? ['veteran'] : [],
    createdAt: iso(90 + (i % 200)),
    updatedAt: iso(i % 30),
  };
}

export const mockClients: CanonicalClient[] = Array.from({ length: 120 }, (_, i) => makeClient(i + 1));

export const mockCampaigns: Campaign[] = [
  {
    id: 'camp-1', tenantId: TENANT, name: 'New Intake Nurture', status: 'Active',
    description: 'Onboard newly registered clients through intake booking.',
    purpose: 'Convert Registration → Intake → Matching',
    ownerId: 'staff-4',
    audienceSummary: 'Lifecycle = Registration for 24h+',
    entryConditions: ['Lifecycle = Registration', 'Contact Allowed'],
    exitConditions: ['Lifecycle advanced to Matching or later', 'Do Not Contact'],
    reenrollmentAllowed: false,
    suppressableClass: 'ordinary_campaign_follow_up',
    steps: [
      { id: 's1', order: 1, type: 'SMS', label: 'Welcome text', delayHours: 1, body: 'Hi {{first}}, welcome to Valorwell. Reply to book your intake.', stopOnReply: true },
      { id: 's2', order: 2, type: 'Wait', label: 'Wait 2 days', delayHours: 48 },
      { id: 's3', order: 3, type: 'Email', label: 'Follow-up email', subject: 'Ready when you are', body: '<p>Hi {{first}},</p><p>Let us know a time that works.</p>' },
      { id: 's4', order: 4, type: 'Internal Task', label: 'Manual review if no response', delayHours: 72 },
    ],
    metrics: { enrolled: 214, active: 47, completed: 132, responseRate: 0.41, suppressed: 12, failed: 3 },
    createdAt: iso(180), updatedAt: iso(2),
  },
  {
    id: 'camp-2', tenantId: TENANT, name: 'Went Dark Reactivation', status: 'Active',
    purpose: 'Re-engage clients whose engagement dropped to Went Dark',
    ownerId: 'staff-5',
    audienceSummary: 'Engagement = Went Dark, Contact Allowed',
    entryConditions: ['Engagement = Went Dark', 'Contact Allowed'],
    exitConditions: ['Engagement moves to Engaged/Warm', 'Client replies'],
    reenrollmentAllowed: true,
    suppressableClass: 'ordinary_campaign_follow_up',
    steps: [
      { id: 's1', order: 1, type: 'SMS', label: 'Check-in', body: 'Hi {{first}}, checking in. Reply if you would like to continue care.', stopOnReply: true },
      { id: 's2', order: 2, type: 'Wait', label: 'Wait 5 days', delayHours: 120 },
      { id: 's3', order: 3, type: 'Email', label: 'Second touch', subject: 'Still here for you' },
      { id: 's4', order: 4, type: 'Manual Review', label: 'Clinician review' },
    ],
    metrics: { enrolled: 88, active: 22, completed: 41, responseRate: 0.28, suppressed: 6, failed: 1 },
    createdAt: iso(120), updatedAt: iso(1),
  },
  {
    id: 'camp-3', tenantId: TENANT, name: 'Waitlist Weekly Update', status: 'Paused',
    purpose: 'Keep waitlisted clients engaged',
    ownerId: 'staff-4',
    audienceSummary: 'Lifecycle = Wait Path',
    entryConditions: ['Lifecycle = Wait Path'],
    exitConditions: ['Lifecycle changes'],
    reenrollmentAllowed: true,
    suppressableClass: 'ordinary_campaign_follow_up',
    steps: [
      { id: 's1', order: 1, type: 'Email', label: 'Weekly status', subject: 'Waitlist update', body: '<p>Update on your placement.</p>' },
      { id: 's2', order: 2, type: 'Wait', label: 'Wait 7 days', delayHours: 168 },
    ],
    metrics: { enrolled: 61, active: 0, completed: 61, responseRate: 0.12, suppressed: 2, failed: 0 },
    createdAt: iso(200), updatedAt: iso(15),
  },
];

export const mockEnrollments: CampaignEnrollment[] = mockClients
  .filter(c => c.activeCampaignId)
  .map((c, i) => ({
    id: `enr-${i}`, campaignId: c.activeCampaignId!, clientId: c.id,
    status: 'Active', currentStepId: 's2', startedAt: iso(7 + (i % 20)),
    nextActionAt: iso(-(1 + i % 5)), completedSteps: ['s1'],
  }));

export const mockTasks: CrmTask[] = Array.from({ length: 40 }, (_, i) => {
  const client = mockClients[i % mockClients.length];
  const overdue = i % 4 === 0;
  return {
    id: `task-${i}`, tenantId: TENANT,
    title: [
      'Follow up on missed intake', 'Verify eligibility documents', 'Reassign clinician',
      'Review client reply', 'Schedule intake call', 'Escalate at-risk client'
    ][i % 6],
    description: 'Automated task generated from operational rule.',
    clientId: client.id,
    type: rand(['Client Follow-Up','Campaign Exception','Eligibility Review','Risk Intervention','Match Review'] as const, i),
    priority: rand(['Low','Normal','High','Urgent'] as const, i),
    status: rand(['Not Started','In Progress','Waiting','Blocked'] as const, i),
    ownerId: rand(['staff-1','staff-2','staff-3','staff-4','staff-5'], i),
    collaboratorIds: [],
    createdByProfileId: 'system',
    startAt: iso(i % 10),
    dueAt: overdue ? iso(1 + i % 10) : iso(-(1 + i % 10)),
    checklist: [],
    tags: [],
    createdAt: iso(i % 30),
    updatedAt: iso(i % 5),
  };
});

export const mockExceptions: OperationalException[] = Array.from({ length: 24 }, (_, i) => {
  const client = mockClients[i % mockClients.length];
  return {
    id: `exc-${i}`, tenantId: TENANT,
    type: rand([
      'Campaign Message Failed','Campaign Step Overdue','Client Reply Needs Review','Client Went Dark',
      'Client Became At Risk','Missed Appointment Follow-Up','Eligibility Verification Failed',
      'No Clinician Match Found','Communication Suppressed','Assignment Missing'
    ] as const, i),
    severity: rand(['Low','Medium','High','Critical'] as const, i),
    status: rand(['Open','In Review','Resolved','Dismissed'] as const, i),
    clientId: client.id,
    ownerId: rand(['staff-4','staff-5'], i),
    createdAt: iso(i % 20),
    dueAt: iso(-(1 + i % 5)),
    lastActivityAt: iso(i % 3),
    summary: `Automatic exception for ${client.legalFirstName} ${client.legalLastName}`,
    recommendedResolution: 'Review and resolve or create task',
    resolutionHistory: [],
  };
});

export const mockAudit: Record<string, AuditEvent[]> = {};
mockClients.forEach(c => {
  mockAudit[c.id] = [
    { id: `${c.id}-a1`, tenantId: TENANT, clientId: c.id, eventType: 'lifecycle_stage', eventLabel: 'Lifecycle changed', previousValue: 'Registration', newValue: c.lifecycle, actor: { label: 'System', automated: true }, source: 'lifecycle_engine', createdAt: iso(30) },
    { id: `${c.id}-a2`, tenantId: TENANT, clientId: c.id, eventType: 'engagement_state', eventLabel: 'Engagement changed', previousValue: 'Engaged', newValue: c.engagement, actor: { label: 'System', automated: true }, source: 'engagement_engine', createdAt: iso(10) },
  ];
});

export const mockMessages: CommunicationMessage[] = mockClients.flatMap((c, i) => {
  const thread = `thread-${c.id}`;
  return [
    { id: `msg-${i}-1`, tenantId: TENANT, clientId: c.id, channel: 'sms', direction: 'outbound', from: '+15555550100', to: c.phone || '', body: `Hi ${c.legalFirstName}, checking in.`, status: 'delivered', threadId: thread, createdAt: iso(i % 10, 4) },
    { id: `msg-${i}-2`, tenantId: TENANT, clientId: c.id, channel: 'sms', direction: 'inbound', from: c.phone || '', to: '+15555550100', body: i % 13 === 0 ? 'STOP' : 'Thanks!', status: 'received', threadId: thread, createdAt: iso(i % 10, 2) },
  ];
});
