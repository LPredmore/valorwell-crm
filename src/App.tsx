import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import RelationshipUnsubscribePage from "./pages/RelationshipUnsubscribePage";
import { CrmLayout } from "./components/crm/layout/CrmLayout";
import CrmIndex from "./pages/crm/Index";
import CrmSettings from "./pages/crm/Settings";
import EmailStudioSpikePage from "./pages/crm/EmailStudioSpikePage";
import CrmCampaignEditor from "./pages/crm/CampaignEditor";
import CrmCampaignEnrollments from "./pages/crm/CampaignEnrollments";
import BusinessDevelopmentArchitecture from "./pages/crm/BusinessDevelopmentArchitecture";
import BusinessDevelopmentDashboard from "./pages/crm/business-development/BusinessDevelopmentDashboard";
import OrganizationDirectoryPage from "./pages/crm/business-development/OrganizationDirectoryPage";
import OrganizationFormPage from "./pages/crm/business-development/OrganizationFormPage";
import OrganizationDetailPage from "./pages/crm/business-development/OrganizationDetailPage";
import ContactDirectoryPage from "./pages/crm/business-development/ContactDirectoryPage";
import ContactDetailPage from "./pages/crm/business-development/ContactDetailPage";
import OpportunityDirectoryPage from "./pages/crm/business-development/OpportunityDirectoryPage";
import OpportunityDetailPage from "./pages/crm/business-development/OpportunityDetailPage";
import RelationshipImportPage from "./pages/crm/business-development/RelationshipImportPage";
import RelationshipReplyQueuePage from "./pages/crm/business-development/RelationshipReplyQueuePage";
import RelationshipReportsPage from "./pages/crm/business-development/RelationshipReportsPage";
import RelationshipSearchPage from "./pages/crm/business-development/RelationshipSearchPage";
import RelationshipSuppressionPage from "./pages/crm/business-development/RelationshipSuppressionPage";
import RelationshipCampaignDeliveryPage from "./pages/crm/business-development/campaigns/RelationshipCampaignDeliveryPage";
import RelationshipCampaignDirectoryPage from "./pages/crm/business-development/campaigns/RelationshipCampaignDirectoryPage";
import RelationshipCampaignEditorPage from "./pages/crm/business-development/campaigns/RelationshipCampaignEditorPage";
import RelationshipCampaignEnrollmentsPage from "./pages/crm/business-development/campaigns/RelationshipCampaignEnrollmentsPage";
import RelationshipCampaignPreviewPage from "./pages/crm/business-development/campaigns/RelationshipCampaignPreviewPage";
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
          <Route path="/unsubscribe" element={<RelationshipUnsubscribePage />} />
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
            <Route path="business-development/search" element={<RelationshipSearchPage />} />
            <Route path="business-development/organizations" element={<OrganizationDirectoryPage />} />
            <Route path="business-development/organizations/new" element={<OrganizationFormPage />} />
            <Route path="business-development/organizations/:id/edit" element={<OrganizationFormPage />} />
            <Route path="business-development/organizations/:id" element={<OrganizationDetailPage />} />
            <Route path="business-development/contacts" element={<ContactDirectoryPage />} />
            <Route path="business-development/contacts/:id" element={<ContactDetailPage />} />
            <Route path="business-development/opportunities" element={<OpportunityDirectoryPage />} />
            <Route path="business-development/opportunities/:id" element={<OpportunityDetailPage />} />
            <Route path="business-development/imports" element={<RelationshipImportPage />} />
            <Route path="business-development/campaigns" element={<RelationshipCampaignDirectoryPage />} />
            <Route path="business-development/campaigns/new" element={<RelationshipCampaignEditorPage />} />
            <Route path="business-development/campaigns/preview" element={<RelationshipCampaignPreviewPage />} />
            <Route path="business-development/campaigns/:id/enrollments" element={<RelationshipCampaignEnrollmentsPage />} />
            <Route path="business-development/campaigns/:id/delivery" element={<RelationshipCampaignDeliveryPage />} />
            <Route path="business-development/campaigns/:id" element={<RelationshipCampaignEditorPage />} />
            <Route path="business-development/replies" element={<RelationshipReplyQueuePage />} />
            <Route path="business-development/suppressions" element={<RelationshipSuppressionPage />} />
            <Route path="business-development/reports" element={<RelationshipReportsPage />} />
            <Route path="creator-community-interest" element={<CreatorCommunityInterestQueue />} />
            <Route path="creator-community-interest/:id" element={<CreatorCommunityInterestDetail />} />
            <Route path="email-studio-spike" element={<EmailStudioSpikePage />} />
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
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
