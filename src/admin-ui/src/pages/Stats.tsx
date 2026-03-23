import { useEffect, useState } from "react";
import { getUsageStats, getRequestLogs } from "@/lib/api";
import type { UsageStats, RequestLog } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";

export default function StatsPage() {
  const [stats, setStats] = useState<UsageStats[]>([]);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [logUserId, setLogUserId] = useState("");

  const loadStats = () => {
    getUsageStats({ billingMonth: month }).then((r) => setStats(r.data));
  };

  const loadLogs = () => {
    const params: Record<string, string> = { limit: "100" };
    if (logUserId) params.userId = logUserId;
    getRequestLogs(params).then((r) => setLogs(r.data));
  };

  useEffect(() => { loadStats(); }, []);

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Usage Statistics</h2>

      <Tabs defaultValue="usage">
        <TabsList>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="logs">Request Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="usage" className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label>Billing Month</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <Button onClick={loadStats}>
              <Search className="h-4 w-4 mr-2" /> Query
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead>Tool Name</TableHead>
                  <TableHead className="text-right">Call Count</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{s.userId}</TableCell>
                    <TableCell>{s.toolName}</TableCell>
                    <TableCell className="text-right">{s.count}</TableCell>
                    <TableCell className="text-right">{s.totalCost.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
                {stats.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No usage data
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label>User ID (optional)</Label>
              <Input value={logUserId} onChange={(e) => setLogUserId(e.target.value)} placeholder="Filter by user ID" />
            </div>
            <Button onClick={loadLogs}>
              <Search className="h-4 w-4 mr-2" /> Query
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(l.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{l.method}</TableCell>
                    <TableCell>{l.toolName || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={l.responseStatus === "success" ? "default" : "destructive"}>
                        {l.responseStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{l.responseTimeMs}ms</TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No logs. Click Query to load.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
