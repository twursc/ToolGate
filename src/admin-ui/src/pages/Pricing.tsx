import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  displayName: string;
  provider: string;
  unitPrice: number;
  updatedAt: string | null;
}

export default function PricingPage() {
  const { t } = useTranslation();
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

    // Build provider key set and detect separator from tool names
    const providerKeys = new Set(providers.map((p) => p.key));

    // Extract provider key from a qualified tool name by matching known provider keys
    const parseToolName = (qualifiedName: string): { provider: string; displayName: string } => {
      for (const pk of providerKeys) {
        if (qualifiedName.startsWith(pk) && qualifiedName.length > pk.length) {
          return { provider: pk, displayName: qualifiedName.slice(pk.length + 1) };
        }
      }
      return { provider: "-", displayName: qualifiedName };
    };

    // Collect all tools from providers (tools are already qualified names)
    const allTools = new Map<string, ToolRow>();
    for (const prov of providers) {
      for (const tool of prov.tools) {
        const existing = priceMap.get(tool);
        const { displayName } = parseToolName(tool);
        allTools.set(tool, {
          toolName: tool,
          displayName,
          provider: prov.key,
          unitPrice: existing?.unitPrice ?? 0,
          updatedAt: existing?.updatedAt ?? null,
        });
      }
    }

    // Also include prices that don't match any current provider tool
    for (const p of prices) {
      if (!allTools.has(p.toolName)) {
        const parsed = parseToolName(p.toolName);
        allTools.set(p.toolName, {
          toolName: p.toolName,
          displayName: parsed.displayName,
          provider: parsed.provider,
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
      toast.success(t("pricing.toast.updated", { count: prices.length }));
      setEdits({});
      load();
    } catch {
      toast.error(t("pricing.toast.updateFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">{t("pricing.title")}</h2>
        <Button disabled={!hasEdits || saving} onClick={handleSaveAll}>
          <Save className="h-4 w-4 mr-2" /> {hasEdits ? t("pricing.saveCount", { count: Object.keys(edits).length }) : t("pricing.saveAll")}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("pricing.provider")}</TableHead>
              <TableHead>{t("pricing.toolName")}</TableHead>
              <TableHead>{t("pricing.unitPrice")}</TableHead>
              <TableHead>{t("pricing.updated")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.toolName} className={edits[r.toolName] !== undefined ? "bg-muted/50" : ""}>
                <TableCell className="text-muted-foreground">{r.provider}</TableCell>
                <TableCell className="font-medium">{r.displayName}</TableCell>
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
                  {t("pricing.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
