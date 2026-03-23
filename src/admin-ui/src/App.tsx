import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AdminLayout from "@/components/layout/AdminLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import UsersPage from "@/pages/Users";
import UserDetail from "@/pages/UserDetail";
import ProvidersPage from "@/pages/Providers";
import ProviderDetail from "@/pages/ProviderDetail";
import StatsPage from "@/pages/Stats";
import PricingPage from "@/pages/Pricing";
import PlaygroundPage from "@/pages/Playground";

export default function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <Routes>
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/:id" element={<UserDetail />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="providers/:key" element={<ProviderDetail />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="pricing" element={<PricingPage />} />
            <Route path="playground" element={<PlaygroundPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/admin/" replace />} />
        </Routes>
        <Toaster />
      </TooltipProvider>
    </BrowserRouter>
  );
}
