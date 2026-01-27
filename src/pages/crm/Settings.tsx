import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function CrmSettings() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="grid gap-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Email Templates</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Email template management will be available in Phase 4.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Missive Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Missive email integration will be available in Phase 3.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
