import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { RichTextEditor } from '@/components/crm/shared/RichTextEditor';
import { sanitizeHtml } from '@/lib/sanitize';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, Trash2, Star, Image, Type, Loader2 } from 'lucide-react';
import {
  useEmailSignatures,
  useCreateSignature,
  useUpdateSignature,
  useDeleteSignature,
  type EmailSignature,
} from '@/hooks/crm/useEmailSignatures';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SignatureFormState {
  name: string;
  signature_type: 'text' | 'image';
  body_html: string;
  image_url: string;
  is_default: boolean;
}

const emptyForm: SignatureFormState = {
  name: '',
  signature_type: 'text',
  body_html: '',
  image_url: '',
  is_default: false,
};

export function EmailSignaturesPanel() {
  const { data: signatures, isLoading } = useEmailSignatures();
  const createMutation = useCreateSignature();
  const updateMutation = useUpdateSignature();
  const deleteMutation = useDeleteSignature();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SignatureFormState>(emptyForm);
  const [uploading, setUploading] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (sig: EmailSignature) => {
    setEditingId(sig.id);
    setForm({
      name: sig.name,
      signature_type: sig.signature_type,
      body_html: sig.body_html || '',
      image_url: sig.image_url || '',
      is_default: sig.is_default,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;

    if (editingId) {
      await updateMutation.mutateAsync({
        id: editingId,
        name: form.name,
        signature_type: form.signature_type,
        body_html: form.signature_type === 'text' ? form.body_html : null,
        image_url: form.signature_type === 'image' ? form.image_url : null,
        is_default: form.is_default,
      });
    } else {
      await createMutation.mutateAsync({
        name: form.name,
        signature_type: form.signature_type,
        body_html: form.signature_type === 'text' ? form.body_html : undefined,
        image_url: form.signature_type === 'image' ? form.image_url : undefined,
        is_default: form.is_default,
      });
    }
    setDialogOpen(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('email-signatures')
        .upload(path, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('email-signatures')
        .getPublicUrl(path);

      setForm((f) => ({ ...f, image_url: urlData.publicUrl }));
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isFormValid =
    form.name.trim() &&
    ((form.signature_type === 'text' && form.body_html.trim()) ||
      (form.signature_type === 'image' && form.image_url));

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Email Signatures</CardTitle>
              <CardDescription>Create text or image signatures for outgoing emails.</CardDescription>
            </div>
            <Button size="sm" onClick={openCreate} className="gap-1">
              <Plus className="h-4 w-4" />
              New Signature
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !signatures?.length ? (
            <p className="text-sm text-muted-foreground">No signatures yet. Create one to get started.</p>
          ) : (
            <div className="space-y-3">
              {signatures.map((sig) => (
                <div
                  key={sig.id}
                  className="flex items-start justify-between gap-4 p-3 border rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {sig.signature_type === 'text' ? (
                        <Type className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Image className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">{sig.name}</span>
                      {sig.is_default && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Star className="h-3 w-3" /> Default
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground truncate">
                      {sig.signature_type === 'image' ? (
                        sig.image_url && (
                          <img
                            src={sig.image_url}
                            alt="Signature preview"
                            className="max-h-12 mt-1"
                          />
                        )
                      ) : (
                        <div
                          className="line-clamp-1"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(sig.body_html) }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(sig)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(sig.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Signature' : 'New Signature'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. My Personal Sig"
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.signature_type}
                onValueChange={(v: 'text' | 'image') =>
                  setForm((f) => ({ ...f, signature_type: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text (Rich Text)</SelectItem>
                  <SelectItem value="image">Image</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.signature_type === 'text' ? (
              <div className="space-y-2">
                <Label>Signature Content</Label>
                <RichTextEditor
                  value={form.body_html}
                  onChange={(html) => setForm((f) => ({ ...f, body_html: html }))}
                  placeholder="Best regards, ..."
                  minHeight="100px"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Signature Image</Label>
                <Input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
                {uploading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Uploading...
                  </div>
                )}
                {form.image_url && (
                  <img
                    src={form.image_url}
                    alt="Signature preview"
                    className="max-h-24 border rounded p-1 mt-1"
                  />
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_default}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_default: v }))}
              />
              <Label>Set as default signature</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isFormValid || isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingId ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
