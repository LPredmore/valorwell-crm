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
import BusinessDevelopmentArchitecture from "./pages/crm/BusinessDevelopmentArchitecture";
import BusinessDevelopmentDashboard from "./pages/crm/business-development/BusinessDevelopmentDashboard";
import { CapabilityPage } from "./pages/crm/business-development/CapabilityPage";
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
            <Route path="business-development" element={<BusinessDevelopmentDashboard />} />
            <Route path="business-development/status" element={<BusinessDevelopmentArchitecture />} />
            <Route path="business-development/organizations" element={<CapabilityPage title="Organizations" capability="organizations" description="Search, review, and manage organization relationships." />} />
            <Route path="business-development/contacts" element={<CapabilityPage title="Relationship contacts" capability="contacts" description="Manage named people and role-based organizational inboxes." />} />
            <Route path="business-development/opportunities" element={<CapabilityPage title="BTY opportunities" capability="opportunities" description="Qualify Beyond The Yellow opportunities and intentional next steps." />} />
            <Route path="business-development/imports" element={<CapabilityPage title="Organization imports" capability="imports" description="Preview CSV mappings, normalization, duplicates, and conflicts before write operations." />} />
            <Route path="business-development/campaigns" element={<CapabilityPage title="Relationship campaigns" capability="campaigns" description="Relationship-only campaigns; clinical campaign infrastructure is never used." />} />
            <Route path="business-development/replies" element={<CapabilityPage title="Relationship replies" capability="replies" description="Replies are kept out of clinical communications and stop further relationship automation." />} />
            <Route path="business-development/suppressions" element={<CapabilityPage title="Relationship suppressions" capability="suppression" description="Manage relationship outreach do-not-contact and unsubscribe controls." />} />
            <Route path="business-development/reports" element={<CapabilityPage title="Business Development reports" capability="reporting" description="Operational reporting distinguishes unavailable data from zero activity." />} />
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
