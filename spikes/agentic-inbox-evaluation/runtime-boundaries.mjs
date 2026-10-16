// Test-only runtime/provider boundaries. No real credentials or network calls.
const state = () => globalThis.__inboxSpike;
export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export class AIChatAgent {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.name = ctx.name; this.messages = []; }
  async persistMessages(messages) { this.messages = messages; }
}
export const createWorkersAI = () => model => ({ model });
export const convertToModelMessages = async messages => messages;
export const stepCountIs = count => count;
export async function generateText(options) {
  state().upstreamPrompts.push(options);
  if (state().modelFailure) throw new Error('scripted model outage');
  const tool = options.tools.draft_reply;
  const args = state().upstreamDraftArgs(options);
  await tool.execute(args);
  return { text: '', steps: [{ toolCalls: [{ toolName: 'draft_reply', args }] }] };
}
export function streamText(options) {
  state().chatPrompts.push(options);
  return { toUIMessageStreamResponse: () => new Response('offline chat fixture') };
}
export const supabase = new Proxy({}, { get: (_, key) => {
  const value = state().dbClient[key];
  return typeof value === 'function' ? value.bind(state().dbClient) : value;
} });
export const createClient = () => supabase;
export class Resend {
  constructor() { this.webhooks = { verify() { throw new Error('No signature fixture; live webhook endpoint is not exercised'); } }; }
}
