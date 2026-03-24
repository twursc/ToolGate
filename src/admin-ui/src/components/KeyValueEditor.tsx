import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

interface KeyValueEntry {
  key: string;
  value: string;
}

interface KeyValueEditorProps {
  label: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

function toEntries(record: Record<string, string>): KeyValueEntry[] {
  const entries = Object.entries(record).map(([key, value]) => ({ key, value }));
  return entries.length > 0 ? entries : [];
}

function toRecord(entries: KeyValueEntry[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { key, value } of entries) {
    const trimmed = key.trim();
    if (trimmed) result[trimmed] = value;
  }
  return result;
}

export function KeyValueEditor({
  label,
  value,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: KeyValueEditorProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<KeyValueEntry[]>(toEntries(value));

  useEffect(() => {
    setEntries(toEntries(value));
  }, [JSON.stringify(value)]);

  const update = (newEntries: KeyValueEntry[]) => {
    setEntries(newEntries);
    onChange(toRecord(newEntries));
  };

  const handleChange = (index: number, field: "key" | "value", val: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], [field]: val };
    update(updated);
  };

  const handleAdd = () => {
    setEntries([...entries, { key: "", value: "" }]);
  };

  const handleRemove = (index: number) => {
    update(entries.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            className="flex-1"
            placeholder={keyPlaceholder}
            value={entry.key}
            onChange={(e) => handleChange(i, "key", e.target.value)}
          />
          <Input
            className="flex-1"
            placeholder={valuePlaceholder}
            value={entry.value}
            onChange={(e) => handleChange(i, "value", e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => handleRemove(i)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAdd}
      >
        <Plus className="h-4 w-4 mr-1" /> {t("common.add")}
      </Button>
    </div>
  );
}
