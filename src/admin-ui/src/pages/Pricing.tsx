import { useEffect, useState } from "react";
import { listToolPrices, setToolPrice } from "@/lib/api";
import type { ToolPrice } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Save } from "lucide-react";

export default function PricingPage() {
  const [prices, setPrices] = useState<ToolPrice[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = () => listToolPrices().then((r) => setPrices(r.data));

  useEffect(() => { load(); }, []);

  const handleSave = async (toolName: string) => {
    const val = edits[toolName];
    if (val === undefined) return;
    try {
      await setToolPrice(toolName, Number(val));
      toast.success(`Price updated for ${toolName}`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[toolName];
        return next;
      });
      load();
    } catch {
      toast.error("Failed to update price");
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Tool Pricing</h2>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool Name</TableHead>
              <TableHead>Unit Price</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prices.map((p) => (
              <TableRow key={p.toolName}>
                <TableCell className="font-medium">{p.toolName}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.0001"
                    className="w-32"
                    value={edits[p.toolName] ?? String(p.unitPrice)}
                    onChange={(e) => setEdits({ ...edits, [p.toolName]: e.target.value })}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(p.updatedAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={edits[p.toolName] === undefined}
                    onClick={() => handleSave(p.toolName)}
                  >
                    <Save className="h-4 w-4 mr-1" /> Save
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {prices.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No tool prices configured
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
