import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { playgroundListTools } from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ToolItem {
  name: string;
  providerKey: string;
  description?: string;
}

interface ToolSelectorProps {
  value: string[] | null;
  onChange: (tools: string[] | null) => void;
}

export default function ToolSelector({ value, onChange }: ToolSelectorProps) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const allowAll = value === null;

  useEffect(() => {
    playgroundListTools()
      .then((r) => setTools(r.data.tools ?? []))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const filtered = search
      ? tools.filter(
          (t) =>
            t.name.toLowerCase().includes(search.toLowerCase()) ||
            (t.description ?? "").toLowerCase().includes(search.toLowerCase())
        )
      : tools;
    return filtered.reduce<Record<string, ToolItem[]>>((acc, tool) => {
      const pk = tool.providerKey;
      if (!acc[pk]) acc[pk] = [];
      acc[pk].push(tool);
      return acc;
    }, {});
  }, [tools, search]);

  const handleAllowAllChange = (checked: boolean) => {
    if (checked) {
      onChange(null);
    } else {
      onChange([]);
    }
  };

  const handleToggleTool = (toolName: string) => {
    const current = value ?? [];
    if (current.includes(toolName)) {
      onChange(current.filter((t) => t !== toolName));
    } else {
      onChange([...current, toolName]);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch checked={allowAll} onCheckedChange={handleAllowAllChange} />
        <Label className="text-sm">{t("toolSelector.allowAll")}</Label>
      </div>

      {!allowAll && (
        <>
          <Input
            placeholder={t("toolSelector.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />

          {!allowAll && value && value.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("toolSelector.selectedCount", { count: value.length })}
            </p>
          )}

          <div className="max-h-64 overflow-y-auto rounded-md border p-2 space-y-3">
            {Object.keys(grouped).length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">{t("toolSelector.noTools")}</p>
            ) : (
              Object.entries(grouped).map(([provider, providerTools]) => (
                <div key={provider}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">{provider}</p>
                  <div className="space-y-1">
                    {providerTools.map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-start gap-2 py-1 px-1 rounded hover:bg-muted cursor-pointer"
                        onClick={() => handleToggleTool(tool.name)}
                      >
                        <Checkbox
                          checked={(value ?? []).includes(tool.name)}
                          onCheckedChange={() => handleToggleTool(tool.name)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <span className="text-sm font-mono">{tool.name}</span>
                          {tool.description && (
                            <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
