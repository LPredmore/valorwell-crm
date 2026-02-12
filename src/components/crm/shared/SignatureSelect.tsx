import { useEmailSignatures, type EmailSignature } from '@/hooks/crm/useEmailSignatures';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { PenLine } from 'lucide-react';

interface SignatureSelectProps {
  value: string; // signature id or 'none'
  onChange: (signatureId: string) => void;
  className?: string;
}

export function SignatureSelect({ value, onChange, className }: SignatureSelectProps) {
  const { data: signatures, isLoading } = useEmailSignatures();

  if (isLoading || !signatures || signatures.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <PenLine className="h-4 w-4 text-muted-foreground shrink-0" />
      <Label className="text-sm text-muted-foreground whitespace-nowrap">Signature:</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[200px] h-8 text-sm">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {signatures.map((sig) => (
            <SelectItem key={sig.id} value={sig.id}>
              {sig.name} {sig.is_default ? '(default)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Hook to get the default signature ID */
export function useDefaultSignatureId(): string {
  const { data: signatures } = useEmailSignatures();
  const defaultSig = signatures?.find((s) => s.is_default);
  return defaultSig?.id || 'none';
}
