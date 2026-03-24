import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDashboardStats } from "@/lib/api";
import { Activity, CheckCircle, DollarSign, Clock } from "lucide-react";
import type { DashboardStats } from "@/lib/types";

export default function Dashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStats()
      .then((r) => setStats(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (!stats) return null;

  const successRate =
    stats.totalRequests > 0
      ? ((stats.successCount / stats.totalRequests) * 100).toFixed(1)
      : "0.0";

  const kpiCards = [
    {
      label: t("dashboard.totalRequests"),
      value: stats.totalRequests.toLocaleString(),
      icon: Activity,
    },
    {
      label: t("dashboard.successRate"),
      value: `${successRate}%`,
      sub: t("dashboard.successRateSub", {
        success: stats.successCount,
        error: stats.errorCount,
      }),
      icon: CheckCircle,
    },
    {
      label: t("dashboard.avgResponseTime"),
      value: `${stats.avgResponseTimeMs} ms`,
      icon: Clock,
    },
    {
      label: t("dashboard.totalCost"),
      value: `$${stats.totalCost.toFixed(4)}`,
      icon: DollarSign,
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">{t("dashboard.title")}</h2>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        {kpiCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{card.value}</div>
              {card.sub && (
                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Two tables side by side */}
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        {/* Top 10 Tools */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dashboard.topTools")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.toolStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("dashboard.toolName")}</TableHead>
                    <TableHead className="text-right">{t("dashboard.calls")}</TableHead>
                    <TableHead className="text-right">{t("dashboard.avgTime")}</TableHead>
                    <TableHead className="text-right">{t("dashboard.cost")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.toolStats.map((tool) => (
                    <TableRow key={tool.toolName}>
                      <TableCell className="font-mono text-xs max-w-48 truncate" title={tool.toolName}>
                        {tool.toolName}
                      </TableCell>
                      <TableCell className="text-right">{tool.callCount}</TableCell>
                      <TableCell className="text-right">{tool.avgResponseTimeMs} ms</TableCell>
                      <TableCell className="text-right">${tool.totalCost.toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Top 10 Users */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dashboard.topUsers")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.userStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("dashboard.username")}</TableHead>
                    <TableHead className="text-right">{t("dashboard.calls")}</TableHead>
                    <TableHead className="text-right">{t("dashboard.cost")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.userStats.map((user) => (
                    <TableRow key={user.userId}>
                      <TableCell>{user.username ?? user.userId.slice(0, 8)}</TableCell>
                      <TableCell className="text-right">{user.callCount}</TableCell>
                      <TableCell className="text-right">${user.totalCost.toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Errors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("dashboard.recentErrors")}</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recentErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noErrors")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("dashboard.time")}</TableHead>
                  <TableHead>{t("dashboard.username")}</TableHead>
                  <TableHead>{t("dashboard.toolName")}</TableHead>
                  <TableHead>{t("dashboard.errorMessage")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recentErrors.map((err, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(err.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{err.username ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{err.toolName ?? "-"}</TableCell>
                    <TableCell className="text-xs max-w-96 truncate text-destructive" title={err.errorMessage ?? ""}>
                      {err.errorMessage ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
