import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import { useToast } from '@/hooks/use-toast';

export interface EmailSignature {
  id: string;
  tenant_id: string;
  name: string;
  signature_type: 'text' | 'image';
  body_html: string | null;
  image_url: string | null;
  is_default: boolean;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useEmailSignatures() {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-email-signatures', tenantId],
    queryFn: async (): Promise<EmailSignature[]> => {
      if (!tenantId) return [];

      const { data, error } = await supabase
        .from('crm_email_signatures')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name');

      if (error) throw error;
      return (data || []) as unknown as EmailSignature[];
    },
    enabled: !!tenantId,
  });
}

export function useCreateSignature() {
  const queryClient = useQueryClient();
  const { tenantId, userId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (sig: {
      name: string;
      signature_type: 'text' | 'image';
      body_html?: string;
      image_url?: string;
      is_default?: boolean;
    }) => {
      if (!tenantId) throw new Error('Not authenticated');

      // If setting as default, unset existing defaults first
      if (sig.is_default) {
        await supabase
          .from('crm_email_signatures')
          .update({ is_default: false })
          .eq('tenant_id', tenantId)
          .eq('is_default', true);
      }

      const { error } = await supabase.from('crm_email_signatures').insert({
        tenant_id: tenantId,
        name: sig.name,
        signature_type: sig.signature_type,
        body_html: sig.body_html || null,
        image_url: sig.image_url || null,
        is_default: sig.is_default || false,
        created_by_profile_id: userId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-email-signatures'] });
      toast({ title: 'Signature created' });
    },
    onError: (error) => {
      toast({ title: 'Error creating signature', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateSignature() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      signature_type?: 'text' | 'image';
      body_html?: string | null;
      image_url?: string | null;
      is_default?: boolean;
    }) => {
      if (!tenantId) throw new Error('Not authenticated');

      if (updates.is_default) {
        await supabase
          .from('crm_email_signatures')
          .update({ is_default: false })
          .eq('tenant_id', tenantId)
          .eq('is_default', true);
      }

      const { error } = await supabase
        .from('crm_email_signatures')
        .update(updates)
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-email-signatures'] });
      toast({ title: 'Signature updated' });
    },
    onError: (error) => {
      toast({ title: 'Error updating signature', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteSignature() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('crm_email_signatures')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-email-signatures'] });
      toast({ title: 'Signature deleted' });
    },
    onError: (error) => {
      toast({ title: 'Error deleting signature', description: error.message, variant: 'destructive' });
    },
  });
}

/** Returns the HTML for a given signature */
export function getSignatureHtml(sig: EmailSignature): string {
  if (sig.signature_type === 'image' && sig.image_url) {
    return `<img src="${sig.image_url}" alt="Signature" style="max-width:600px">`;
  }
  return sig.body_html || '';
}
