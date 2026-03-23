import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { listProviders, getProviderTools, getUsageStats } from "@/lib/api";
import type { McpProvider, ToolSchema, UsageStats } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";

function SchemaTable({ schema }: { schema: Record<string, unknown> }) {
  const properties = (schema.properties ?? {}) as Record<
    string,
    { type?: string; description?: string; enum?: unknown[] }
  >;
  const required = (schema.required ?? []) as string[];

  if (Object.keys(properties).length === 0) {
    return <p className="text-sm text-muted-foreground">No parameters</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[180px]">Field</TableHead>
          <TableHead className="w-[120px]">Type</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-[80px]">Required</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Object.entries(properties).map(([fieldName, prop]) => (
          <TableRow key={fieldName}>
            <TableCell className="font-mono text-sm">{fieldName}</TableCell>
            <TableCell className="text-sm">
              {prop.enum ? `enum(${prop.enum.join(", ")})` : prop.type ?? "any"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {prop.description ? (
                <pre className="text-xs whitespace-pre-wrap bg-muted/50 px-2 py-1 rounded border font-mono max-h-24 overflow-y-auto">{prop.description}</pre>
              ) : "-"}
            </TableCell>
            <TableCell>
              {required.includes(fieldName) ? (
                <Badge variant="default" className="text-xs">Yes</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">No</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ProviderDetail() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [provider, setProvider] = useState<McpProvider | null>(null);
  const [tools, setTools] = useState<ToolSchema[]>([]);
  const [usage, setUsage] = useState<UsageStats[]>([]);
  const [usageMonth, setUsageMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const loadProvider = async () => {
    if (!key) return;
    const res = await listProviders();
    const found = (res.data as McpProvider[]).find((p) => p.key === key);
    setProvider(found ?? null);
  };

  const loadTools = async () => {
    if (!key) return;
    try {
      const res = await getProviderTools(key);
      setTools(res.data.tools ?? []);
    } catch {
      setTools([]);
    }
  };

  const loadUsage = async (month?: string) => {
    if (!key) return;
    try {
      const res = await getUsageStats({
        provider: key,
        billingMonth: month ?? usageMonth,
        limit: "10000",
      });
      setUsage(res.data.data);
    } catch {
      setUsage([]);
    }
  };

  useEffect(() => {
    loadProvider();
    loadTools();
    loadUsage();
  }, [key]);

  if (!provider) return <div className="text-muted-foreground">Loading...</div>;

  // Group usage by tool
  const toolUsageMap = new Map<string, UsageStats[]>();
  for (const u of usage) {
    const existing = toolUsageMap.get(u.toolName) ?? [];
    existing.push(u);
    toolUsageMap.set(u.toolName, existing);
  }

  const totalCalls = usage.reduce((s, u) => s + u.count, 0);
  const totalCost = usage.reduce((s, u) => s + u.totalCost, 0);

  return (
    <div>
      <Button variant="ghost" className="mb-4" onClick={() => navigate("/admin/providers")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to Providers
      </Button>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {provider.name || provider.key}
            <Badge variant="outline">{provider.type}</Badge>
            <Badge variant={provider.active ? "default" : "secondary"}>
              {provider.active ? "active" : "inactive"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div><span className="text-muted-foreground">Key:</span> {provider.key}</div>
          <div>
            <span className="text-muted-foreground">Connection:</span>{" "}
            {provider.url || `${provider.command} ${provider.args?.join(" ") ?? ""}`}
          </div>
          <div><span className="text-muted-foreground">Tools:</span> {provider.tools.length}</div>
        </CardContent>
      </Card>

      {/* Tools Section - flat display */}
      <h3 className="text-lg font-semibold mb-3">Tools ({tools.length})</h3>
      <div className="space-y-4 mb-6">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className={`border rounded-md p-4 ${tool.hasMismatch ? "border-destructive/50 bg-destructive/5" : ""}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-sm font-medium">{tool.name}</span>
              {tool.hasMismatch && (
                <Badge variant="destructive" className="text-xs">Mismatch</Badge>
              )}
            </div>
            {tool.description && (
              <pre className="text-sm text-muted-foreground mb-3 whitespace-pre-wrap bg-muted/50 p-3 rounded-md border max-h-40 overflow-y-auto font-mono">
                {tool.description}
              </pre>
            )}
            <SchemaTable schema={tool.inputSchema} />
          </div>
        ))}
        {tools.length === 0 && (
          <p className="text-sm text-muted-foreground">No tools available</p>
        )}
      </div>

      {/* Usage Section */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">
          Usage by Tool ({totalCalls} calls, cost: {totalCost.toFixed(4)})
        </h3>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Month</Label>
          <Input
            type="month"
            value={usageMonth}
            className="w-40"
            onChange={(e) => {
              setUsageMonth(e.target.value);
              loadUsage(e.target.value);
            }}
          />
        </div>
      </div>

      {usage.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center border rounded-md">
          No usage data for this month
        </p>
      ) : (
        <div className="space-y-4">
          {Array.from(toolUsageMap.entries()).map(([toolName, stats]) => {
            const toolCalls = stats.reduce((s, u) => s + u.count, 0);
            const toolCost = stats.reduce((s, u) => s + u.totalCost, 0);
            return (
              <Card key={toolName}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-mono flex items-center gap-3">
                    {toolName}
                    <span className="text-muted-foreground font-normal">
                      {toolCalls} calls, cost: {toolCost.toFixed(4)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <Tabs defaultValue="by-user">
                    <TabsList>
                      <TabsTrigger value="by-user">By User</TabsTrigger>
                    </TabsList>
                    <TabsContent value="by-user">
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>User ID</TableHead>
                              <TableHead className="text-right">Calls</TableHead>
                              <TableHead className="text-right">Cost</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {stats.map((s, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-mono text-xs">{s.userId}</TableCell>
                                <TableCell className="text-right">{s.count}</TableCell>
                                <TableCell className="text-right">{s.totalCost.toFixed(4)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
