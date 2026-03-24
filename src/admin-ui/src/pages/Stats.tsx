import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUsageStats, getRequestLogs, listProviders } from "@/lib/api";
import type { UsageStats, RequestLog, McpProvider } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Search, ChevronLeft, ChevronRight, Eye } from "lucide-react";

const PAGE_SIZE = 20;

export default function StatsPage() {
  const { t } = useTranslation();
  // --- Usage state ---
  const [stats, setStats] = useState<UsageStats[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usagePage, setUsagePage] = useState(0);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [usageUserId, setUsageUserId] = useState("");
  const [usageProvider, setUsageProvider] = useState("");
  const [usageToolName, setUsageToolName] = useState("");

  // --- Logs state ---
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(0);
  const [logUserId, setLogUserId] = useState("");

  // --- Params viewer dialog ---
  const [paramsOpen, setParamsOpen] = useState(false);
  const [paramsContent, setParamsContent] = useState("");

  // --- Providers for filter dropdown ---
  const [providers, setProviders] = useState<McpProvider[]>([]);

  const loadStats = (page = 0) => {
    const params: Record<string, string> = {
      billingMonth: month,
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    };
    if (usageUserId) params.userId = usageUserId;
    if (usageProvider && usageProvider !== "__all__") params.provider = usageProvider;
    if (usageToolName) params.toolName = usageToolName;
    getUsageStats(params).then((r) => {
      setStats(r.data.data);
      setUsageTotal(r.data.total);
      setUsagePage(page);
    });
  };

  const loadLogs = (page = 0) => {
    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    };
    if (logUserId) params.userId = logUserId;
    getRequestLogs(params).then((r) => {
      setLogs(r.data.data);
      setLogsTotal(r.data.total);
      setLogsPage(page);
    });
  };

  useEffect(() => {
    loadStats();
    loadLogs();
    listProviders().then((r) => setProviders(r.data));
  }, []);

  const usageTotalPages = Math.max(1, Math.ceil(usageTotal / PAGE_SIZE));
  const logsTotalPages = Math.max(1, Math.ceil(logsTotal / PAGE_SIZE));

  const viewParams = (summary: string) => {
    try {
      setParamsContent(JSON.stringify(JSON.parse(summary), null, 2));
    } catch {
      setParamsContent(summary);
    }
    setParamsOpen(true);
  };

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">{t("stats.title")}</h2>

      <Tabs defaultValue="usage">
        <TabsList>
          <TabsTrigger value="usage">{t("stats.usageTab")}</TabsTrigger>
          <TabsTrigger value="logs">{t("stats.logsTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="usage" className="space-y-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-2">
              <Label>{t("stats.billingMonth")}</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("stats.userId")}</Label>
              <Input value={usageUserId} onChange={(e) => setUsageUserId(e.target.value)} placeholder={t("stats.userIdPlaceholder")} className="w-48" />
            </div>
            <div className="space-y-2">
              <Label>{t("stats.provider")}</Label>
              <Select value={usageProvider} onValueChange={(v) => setUsageProvider(v ?? "")}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder={t("stats.allProviders")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("stats.allProviders")}</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.key}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("stats.toolName")}</Label>
              <Input value={usageToolName} onChange={(e) => setUsageToolName(e.target.value)} placeholder={t("stats.toolNamePlaceholder")} className="w-48" />
            </div>
            <Button onClick={() => loadStats(0)}>
              <Search className="h-4 w-4 mr-2" /> {t("stats.query")}
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stats.username")}</TableHead>
                  <TableHead>{t("stats.toolName")}</TableHead>
                  <TableHead className="text-right">{t("stats.callCount")}</TableHead>
                  <TableHead className="text-right">{t("stats.totalCost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{s.username ?? s.userId}</TableCell>
                    <TableCell>{s.toolName}</TableCell>
                    <TableCell className="text-right">{s.count}</TableCell>
                    <TableCell className="text-right">{s.totalCost.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
                {stats.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      {t("stats.noUsage")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {t("common.results", { count: usageTotal })}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={usagePage === 0} onClick={() => loadStats(usagePage - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">{t("common.page", { current: usagePage + 1, total: usageTotalPages })}</span>
              <Button size="sm" variant="outline" disabled={usagePage + 1 >= usageTotalPages} onClick={() => loadStats(usagePage + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label>{t("stats.userIdOptional")}</Label>
              <Input value={logUserId} onChange={(e) => setLogUserId(e.target.value)} placeholder={t("stats.userIdLogPlaceholder")} />
            </div>
            <Button onClick={() => loadLogs(0)}>
              <Search className="h-4 w-4 mr-2" /> {t("stats.query")}
            </Button>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stats.time")}</TableHead>
                  <TableHead>{t("stats.username")}</TableHead>
                  <TableHead>{t("stats.method")}</TableHead>
                  <TableHead>{t("stats.tool")}</TableHead>
                  <TableHead className="w-[200px]">{t("stats.params")}</TableHead>
                  <TableHead>{t("stats.status")}</TableHead>
                  <TableHead className="text-right">{t("stats.cost")}</TableHead>
                  <TableHead className="text-right">{t("stats.duration")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{l.username || "-"}</TableCell>
                    <TableCell>{l.method}</TableCell>
                    <TableCell>{l.toolName || "-"}</TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-xs text-muted-foreground">{l.requestSummary || "-"}</span>
                        {l.requestSummary && (
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => viewParams(l.requestSummary)}>
                            <Eye className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={l.responseStatus === "success" ? "default" : "destructive"}>
                        {l.responseStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{(l.cost ?? 0).toFixed(4)}</TableCell>
                    <TableCell className="text-right">{l.responseTimeMs}ms</TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      {t("stats.noLogs")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {t("common.results", { count: logsTotal })}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={logsPage === 0} onClick={() => loadLogs(logsPage - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">{t("common.page", { current: logsPage + 1, total: logsTotalPages })}</span>
              <Button size="sm" variant="outline" disabled={logsPage + 1 >= logsTotalPages} onClick={() => loadLogs(logsPage + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Params Viewer Dialog */}
      <Dialog open={paramsOpen} onOpenChange={setParamsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t("stats.requestParams")}</DialogTitle>
          </DialogHeader>
          <pre className="text-sm bg-muted p-4 rounded-md overflow-auto max-h-[60vh] whitespace-pre-wrap font-mono">
            {paramsContent}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
