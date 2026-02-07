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
            <Route path="clients" element={<CrmClients />} />
            <Route path="clients/:id" element={<ClientDetail />} />
            <Route path="staff" element={<CrmStaff />} />
            <Route path="campaigns" element={<CrmCampaigns />} />
            <Route path="campaigns/:id" element={<CrmCampaignEditor />} />
            <Route path="inbox" element={<CrmInbox />} />
            <Route path="settings" element={<CrmSettings />} />
          </Route>
          
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
