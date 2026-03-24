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
  providerKey: string;
  toolName: string;
  unitPrice: number;
  updatedAt: string | null;
}

// Composite key for edits map
const rowKey = (providerKey: string, toolName: string) => `${providerKey}\0${toolName}`;

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

    // Build price lookup by providerKey + toolName
    const priceMap = new Map<string, ToolPrice>();
    for (const p of prices) {
      priceMap.set(rowKey(p.providerKey, p.toolName), p);
    }

    // Collect all tools from providers
    const allTools = new Map<string, ToolRow>();
    for (const prov of providers) {
      for (const qualifiedTool of prov.tools) {
        // Extract pure tool name by removing provider prefix + separator
        const prefix = prov.key;
        let pureName = qualifiedTool;
        if (qualifiedTool.startsWith(prefix) && qualifiedTool.length > prefix.length) {
          // Skip the separator character(s) between provider key and tool name
          const rest = qualifiedTool.slice(prefix.length);
          pureName = rest.replace(/^[^a-zA-Z0-9]+/, "");
        }

        const key = rowKey(prov.key, pureName);
        const existing = priceMap.get(key);
        allTools.set(key, {
          providerKey: prov.key,
          toolName: pureName,
          unitPrice: existing?.unitPrice ?? 0,
          updatedAt: existing?.updatedAt ?? null,
        });
      }
    }

    // Also include prices that don't match any current provider tool
    for (const p of prices) {
      const key = rowKey(p.providerKey, p.toolName);
      if (!allTools.has(key)) {
        allTools.set(key, {
          providerKey: p.providerKey,
          toolName: p.toolName,
          unitPrice: p.unitPrice,
          updatedAt: p.updatedAt,
        });
      }
    }

    // Sort by provider then tool name
    const sorted = Array.from(allTools.values()).sort((a, b) => {
      if (a.providerKey !== b.providerKey) return a.providerKey.localeCompare(b.providerKey);
      return a.toolName.localeCompare(b.toolName);
    });

    setRows(sorted);
  };

  useEffect(() => { load(); }, []);

  const hasEdits = Object.keys(edits).length > 0;

  const handleSaveAll = async () => {
    const prices = Object.entries(edits).map(([compositeKey, val]) => {
      const [providerKey, toolName] = compositeKey.split("\0");
      return { providerKey, toolName, unitPrice: Number(val) };
    });
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
            {rows.map((r) => {
              const key = rowKey(r.providerKey, r.toolName);
              return (
                <TableRow key={key} className={edits[key] !== undefined ? "bg-muted/50" : ""}>
                  <TableCell className="text-muted-foreground">{r.providerKey}</TableCell>
                  <TableCell className="font-medium">{r.toolName}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.0001"
                      className="w-32"
                      value={edits[key] ?? String(r.unitPrice)}
                      onChange={(e) => setEdits({ ...edits, [key]: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "-"}
                  </TableCell>
                </TableRow>
              );
            })}
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
