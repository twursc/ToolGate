import { useEffect, useState } from "react";
import { playgroundListTools, playgroundCall } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Play, Loader2 } from "lucide-react";

interface PlaygroundTool {
  name: string;
  providerKey: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface ToolCallResult {
  result: unknown;
  responseTimeMs: number;
  profileKey: string | null;
}

function buildFormDefaults(schema: Record<string, unknown>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; default?: unknown }>;
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.default !== undefined) defaults[key] = prop.default;
    else if (prop.type === "string") defaults[key] = "";
    else if (prop.type === "number" || prop.type === "integer") defaults[key] = "";
    else if (prop.type === "boolean") defaults[key] = false;
    else if (prop.type === "array") defaults[key] = "";
    else defaults[key] = "";
  }
  return defaults;
}

function DynamicForm({
  schema,
  values,
  onChange,
}: {
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const properties = (schema.properties ?? {}) as Record<
    string,
    { type?: string; description?: string; enum?: unknown[]; default?: unknown }
  >;
  const required = (schema.required ?? []) as string[];

  if (Object.keys(properties).length === 0) {
    return <p className="text-sm text-muted-foreground">This tool has no parameters.</p>;
  }

  return (
    <div className="space-y-4">
      {Object.entries(properties).map(([key, prop]) => {
        const isRequired = required.includes(key);
        const value = values[key];
        const type = prop.type ?? "string";

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center gap-1">
              <Label htmlFor={key} className="font-mono text-sm">
                {key}
              </Label>
              {isRequired && <span className="text-destructive text-xs">*</span>}
            </div>
            {prop.enum ? (
              <Select
                value={String(value ?? "")}
                onValueChange={(v) => onChange(key, v)}
              >
                <SelectTrigger id={key}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {prop.enum.map((opt) => (
                    <SelectItem key={String(opt)} value={String(opt)}>
                      {String(opt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : type === "boolean" ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={key}
                  checked={Boolean(value)}
                  onCheckedChange={(checked) => onChange(key, checked)}
                />
                <span className="text-sm text-muted-foreground">{value ? "true" : "false"}</span>
              </div>
            ) : type === "integer" || type === "number" ? (
              <Input
                id={key}
                type="number"
                placeholder={String(prop.default ?? "")}
                value={String(value ?? "")}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange(key, v === "" ? "" : Number(v));
                }}
              />
            ) : (
              <Input
                id={key}
                placeholder={prop.description ?? key}
                value={String(value ?? "")}
                onChange={(e) => onChange(key, e.target.value)}
              />
            )}
            {prop.description && (
              <p className="text-xs text-muted-foreground">{prop.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function prettyPrint(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export default function PlaygroundPage() {
  const [tools, setTools] = useState<PlaygroundTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>("");
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [loadingTools, setLoadingTools] = useState(true);
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<ToolCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    playgroundListTools()
      .then((res) => setTools(res.data.tools ?? []))
      .catch(() => setTools([]))
      .finally(() => setLoadingTools(false));
  }, []);

  const currentTool = tools.find((t) => t.name === selectedTool);

  const handleToolChange = (toolName: string | null) => {
    if (!toolName) {
      setSelectedTool("");
      setResult(null);
      setError(null);
      setFormValues({});
      return;
    }
    setSelectedTool(toolName);
    setResult(null);
    setError(null);
    const tool = tools.find((t) => t.name === toolName);
    if (tool) {
      setFormValues(buildFormDefaults(tool.inputSchema));
    }
  };

  const handleFieldChange = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!selectedTool) return;
    setCalling(true);
    setResult(null);
    setError(null);
    try {
      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(formValues)) {
        if (v !== "" && v !== undefined) args[k] = v;
      }
      const res = await playgroundCall(selectedTool, args);
      setResult(res.data);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? "Unknown error");
    } finally {
      setCalling(false);
    }
  };

  // Group tools by provider
  const grouped = tools.reduce<Record<string, PlaygroundTool[]>>((acc, tool) => {
    const pk = tool.providerKey;
    if (!acc[pk]) acc[pk] = [];
    acc[pk].push(tool);
    return acc;
  }, {});

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Playground</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Tool selection + form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Tool</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingTools ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading tools...</span>
              </div>
            ) : (
              <Select value={selectedTool} onValueChange={handleToolChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a tool..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(grouped).map(([providerKey, providerTools]) => (
                    <div key={providerKey}>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {providerKey}
                      </div>
                      {providerTools.map((tool) => (
                        <SelectItem key={tool.name} value={tool.name}>
                          <span className="font-mono">{tool.name.split("__")[1] ?? tool.name}</span>
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            )}

            {currentTool && (
              <>
                {currentTool.description && (
                  <pre className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md border font-mono max-h-40 overflow-y-auto">
                    {currentTool.description}
                  </pre>
                )}

                <DynamicForm
                  schema={currentTool.inputSchema}
                  values={formValues}
                  onChange={handleFieldChange}
                />

                <Button
                  onClick={handleSubmit}
                  disabled={calling || !selectedTool}
                  className="w-full"
                >
                  {calling ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Calling...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" /> Run Tool</>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Right: Result */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Response</span>
              {result && (
                <Badge variant="outline" className="text-xs font-normal">
                  {result.responseTimeMs}ms
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 font-mono whitespace-pre-wrap">
                {error}
              </div>
            )}
            {!error && !result && (
              <p className="text-sm text-muted-foreground">
                Select a tool and click Run to see the response here.
              </p>
            )}
            {result && (
              <div className="space-y-3">
                {result.profileKey && (
                  <div className="text-xs text-muted-foreground">
                    Profile: <code className="bg-muted px-1 rounded">{result.profileKey}</code>
                  </div>
                )}
                <pre className="text-sm bg-muted/50 border rounded-md p-4 font-mono whitespace-pre-wrap overflow-auto max-h-[500px]">
                  {prettyPrint(result.result)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
