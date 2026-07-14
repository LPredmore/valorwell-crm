import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import { CrmLayout } from "./components/crm/layout/CrmLayout";
import CrmIndex from "./pages/crm/Index";
import CrmClients from "./pages/crm/Clients";
import ClientDetail from "./pages/crm/ClientDetail";
import CrmSettings from "./pages/crm/Settings";
import CrmInbox from "./pages/crm/Inbox";
import CrmStaff from "./pages/crm/Staff";
import CrmCampaigns from "./pages/crm/Campaigns";
import CrmCampaignEditor from "./pages/crm/CampaignEditor";
import CrmCampaignEnrollments from "./pages/crm/CampaignEnrollments";
import CrmReports from "./pages/crm/Reports";
import CanonicalDashboard from "./pages/crm/canonical/CanonicalDashboard";
import CanonicalClients from "./pages/crm/canonical/CanonicalClients";
import CanonicalClientDetail from "./pages/crm/canonical/CanonicalClientDetail";
import CanonicalTasks from "./pages/crm/canonical/CanonicalTasks";
import CanonicalExceptions from "./pages/crm/canonical/CanonicalExceptions";
import CanonicalReports from "./pages/crm/canonical/CanonicalReports";
import CanonicalCampaigns from "./pages/crm/canonical/CanonicalCampaigns";
import CanonicalInbox from "./pages/crm/canonical/CanonicalInbox";
import CanonicalStaff from "./pages/crm/canonical/CanonicalStaff";
import CanonicalCampaignDetail from "./pages/crm/canonical/CanonicalCampaignDetail";
import CanonicalSearch from "./pages/crm/canonical/CanonicalSearch";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          
          {/* CRM Routes */}
          <Route path="/crm" element={<CrmLayout />}>
            <Route index element={<CrmIndex />} />
            {/* Primary CRM surfaces now route to canonical pages.
                Legacy pages remain importable for reference but are unrouted. */}
            <Route path="clients" element={<CanonicalClients />} />
            <Route path="clients/:id" element={<CanonicalClientDetail />} />
            <Route path="clients-legacy" element={<CrmClients />} />
            <Route path="clients-legacy/:id" element={<ClientDetail />} />
            <Route path="staff" element={<CanonicalStaff />} />
            <Route path="staff-legacy" element={<CrmStaff />} />
            <Route path="campaigns" element={<CanonicalCampaigns />} />
            <Route path="campaigns/:id" element={<CanonicalCampaignDetail />} />
            <Route path="campaigns/:id/edit" element={<CrmCampaignEditor />} />
            <Route path="campaigns/:id/enrollments" element={<CrmCampaignEnrollments />} />
            <Route path="tasks" element={<CanonicalTasks />} />
            <Route path="exceptions" element={<CanonicalExceptions />} />
            <Route path="inbox" element={<CanonicalInbox />} />
            <Route path="inbox-legacy" element={<CrmInbox />} />
            <Route path="reports" element={<CanonicalReports />} />
            <Route path="reports-legacy" element={<CrmReports />} />
            <Route path="settings" element={<CrmSettings />} />
            <Route path="canonical" element={<CanonicalDashboard />} />
            <Route path="canonical/clients" element={<CanonicalClients />} />
            <Route path="canonical/clients/:id" element={<CanonicalClientDetail />} />
            <Route path="canonical/tasks" element={<CanonicalTasks />} />
            <Route path="canonical/exceptions" element={<CanonicalExceptions />} />
            <Route path="canonical/campaigns" element={<CanonicalCampaigns />} />
            <Route path="canonical/campaigns/:id" element={<CanonicalCampaignDetail />} />
            <Route path="canonical/inbox" element={<CanonicalInbox />} />
            <Route path="canonical/search" element={<CanonicalSearch />} />
            <Route path="canonical/staff" element={<CanonicalStaff />} />
            <Route path="canonical/reports" element={<CanonicalReports />} />
          </Route>
          
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
