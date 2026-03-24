import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listUsers, listProviders, listToolPrices } from "@/lib/api";
import { Users, Server, DollarSign } from "lucide-react";
import type { User, McpProvider, ToolPrice } from "@/lib/types";

export default function Dashboard() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [providers, setProviders] = useState<McpProvider[]>([]);
  const [prices, setPrices] = useState<ToolPrice[]>([]);

  useEffect(() => {
    listUsers().then((r) => setUsers(r.data));
    listProviders().then((r) => setProviders(r.data));
    listToolPrices().then((r) => setPrices(r.data));
  }, []);

  const stats = [
    { label: t("dashboard.totalUsers"), value: users.length, icon: Users },
    { label: t("dashboard.activeProviders"), value: providers.filter((p) => p.active).length, icon: Server },
    { label: t("dashboard.pricedTools"), value: prices.length, icon: DollarSign },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">{t("dashboard.title")}</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
