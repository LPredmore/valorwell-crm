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
import CrmSettings from "./pages/crm/Settings";
import CrmCampaignEditor from "./pages/crm/CampaignEditor";
import CrmCampaignEnrollments from "./pages/crm/CampaignEnrollments";
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
import CreatorCommunityInterestQueue from "./pages/crm/canonical/CreatorCommunityInterestQueue";
import CreatorCommunityInterestDetail from "./pages/crm/canonical/CreatorCommunityInterestDetail";

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

          {/* CRM Routes — canonical pages only. Legacy pat_status-based
              pages have been removed as part of the canonical cutover. */}
          <Route path="/crm" element={<CrmLayout />}>
            <Route index element={<CrmIndex />} />
            <Route path="clients" element={<CanonicalClients />} />
            <Route path="clients/:id" element={<CanonicalClientDetail />} />
            <Route path="staff" element={<CanonicalStaff />} />
            <Route path="campaigns" element={<CanonicalCampaigns />} />
            <Route path="campaigns/:id" element={<CanonicalCampaignDetail />} />
            <Route path="campaigns/:id/edit" element={<CrmCampaignEditor />} />
            <Route path="campaigns/:id/enrollments" element={<CrmCampaignEnrollments />} />
            <Route path="tasks" element={<CanonicalTasks />} />
            <Route path="exceptions" element={<CanonicalExceptions />} />
            <Route path="inbox" element={<CanonicalInbox />} />
            <Route path="reports" element={<CanonicalReports />} />
            <Route path="creator-community-interest" element={<CreatorCommunityInterestQueue />} />
            <Route path="creator-community-interest/:id" element={<CreatorCommunityInterestDetail />} />
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
