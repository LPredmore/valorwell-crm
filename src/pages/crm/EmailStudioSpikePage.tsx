import { EmailStudioSpike } from '@/features/email-studio/spike/EmailStudioSpike';

export default function EmailStudioSpikePage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Email Studio Compatibility Spike</h1>
        <p className="text-sm text-muted-foreground">
          Pass 1 proof for editor compatibility, structured content, export, JSON reload, and preview isolation.
        </p>
      </div>
      <EmailStudioSpike />
    </div>
  );
}
