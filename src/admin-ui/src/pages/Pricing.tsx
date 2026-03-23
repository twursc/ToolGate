import { useEffect, useState } from "react";
import { listToolPrices, batchUpdateToolPrices, listProviders } from "@/lib/api";
import type { ToolPrice, McpProvider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Save } from "lucide-react";

interface ToolRow {
  toolName: string;
  provider: string;
  unitPrice: number;
  updatedAt: string | null;
}

export default function PricingPage() {
  const [rows, setRows] = useState<ToolRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [pricesRes, providersRes] = await Promise.all([
      listToolPrices(),
      listProviders(),
    ]);
    const prices: ToolPrice[] = pricesRes.data;
    const providers: McpProvider[] = providersRes.data;

    // Build price lookup
    const priceMap = new Map<string, ToolPrice>();
    for (const p of prices) {
      priceMap.set(p.toolName, p);
    }

    // Collect all tools from providers
    const allTools = new Map<string, ToolRow>();
    for (const prov of providers) {
      for (const tool of prov.tools) {
        const fullName = `${prov.key}__${tool}`;
        const existing = priceMap.get(fullName);
        allTools.set(fullName, {
          toolName: fullName,
          provider: prov.key,
          unitPrice: existing?.unitPrice ?? 0,
          updatedAt: existing?.updatedAt ?? null,
        });
      }
    }

    // Also include prices that don't match any current provider tool
    for (const p of prices) {
      if (!allTools.has(p.toolName)) {
        const sep = p.toolName.indexOf("__");
        allTools.set(p.toolName, {
          toolName: p.toolName,
          provider: sep > 0 ? p.toolName.slice(0, sep) : "-",
          unitPrice: p.unitPrice,
          updatedAt: p.updatedAt,
        });
      }
    }

    // Sort by provider then tool name
    const sorted = Array.from(allTools.values()).sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.toolName.localeCompare(b.toolName);
    });

    setRows(sorted);
  };

  useEffect(() => { load(); }, []);

  const hasEdits = Object.keys(edits).length > 0;

  const handleSaveAll = async () => {
    const prices = Object.entries(edits).map(([toolName, val]) => ({
      toolName,
      unitPrice: Number(val),
    }));
    if (prices.length === 0) return;
    setSaving(true);
    try {
      await batchUpdateToolPrices(prices);
      toast.success(`Updated ${prices.length} tool price(s)`);
      setEdits({});
      load();
    } catch {
      toast.error("Failed to update prices");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Tool Pricing</h2>
        <Button disabled={!hasEdits || saving} onClick={handleSaveAll}>
          <Save className="h-4 w-4 mr-2" /> Save All{hasEdits ? ` (${Object.keys(edits).length})` : ""}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Tool Name</TableHead>
              <TableHead>Unit Price</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.toolName} className={edits[r.toolName] !== undefined ? "bg-muted/50" : ""}>
                <TableCell className="text-muted-foreground">{r.provider}</TableCell>
                <TableCell className="font-medium">{r.toolName}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.0001"
                    className="w-32"
                    value={edits[r.toolName] ?? String(r.unitPrice)}
                    onChange={(e) => setEdits({ ...edits, [r.toolName]: e.target.value })}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "-"}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No tools found. Add providers to see available tools.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
