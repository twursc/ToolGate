import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { logout } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Users,
  Server,
  BarChart3,
  DollarSign,
  LogOut,
  LayoutDashboard,
  FlaskConical,
} from "lucide-react";

const navItems = [
  { to: "/admin/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/providers", label: "Providers", icon: Server },
  { to: "/admin/stats", label: "Usage Stats", icon: BarChart3 },
  { to: "/admin/pricing", label: "Tool Pricing", icon: DollarSign },
  { to: "/admin/playground", label: "Playground", icon: FlaskConical },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate("/admin/login");
    }
  };

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 border-r bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold">MCP Gateway</h1>
          <p className="text-xs text-muted-foreground">Admin Panel</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.to === "/admin/"
                ? location.pathname === "/admin/" || location.pathname === "/admin"
                : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 border-t">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
