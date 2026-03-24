import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listGroups, createGroup, updateGroup } from "@/lib/api";
import type { UserGroup } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import ToolSelector from "@/components/ToolSelector";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";

export default function GroupsPage() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", allowedTools: null as string[] | null });

  const [editOpen, setEditOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<UserGroup | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    allowedTools: null as string[] | null,
    status: "active" as "active" | "disabled",
  });

  const load = () => listGroups().then((r) => setGroups(r.data));

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    try {
      await createGroup({
        name: form.name,
        description: form.description || undefined,
        allowedTools: form.allowedTools,
      });
      toast.success(t("groups.toast.created"));
      setCreateOpen(false);
      setForm({ name: "", description: "", allowedTools: null });
      load();
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } };
      if (err.response?.status === 409) {
        toast.error(t("groups.toast.conflict"));
      } else {
        toast.error(t("groups.toast.createFailed"));
      }
    }
  };

  const openEditDialog = (group: UserGroup) => {
    setEditGroup(group);
    setEditForm({
      name: group.name,
      description: group.description || "",
      allowedTools: group.allowedTools,
      status: group.status,
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editGroup) return;
    try {
      await updateGroup(editGroup.id, {
        name: editForm.name,
        description: editForm.description || null,
        allowedTools: editForm.allowedTools,
        status: editForm.status,
      });
      toast.success(t("groups.toast.updated"));
      setEditOpen(false);
      load();
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } };
      if (err.response?.status === 409) {
        toast.error(t("groups.toast.conflict"));
      } else {
        toast.error(t("groups.toast.updateFailed"));
      }
    }
  };

  const toggleStatus = async (group: UserGroup) => {
    const newStatus = group.status === "active" ? "disabled" : "active";
    await updateGroup(group.id, { status: newStatus });
    toast.success(t("groups.toast.updated"));
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">{t("groups.title")}</h2>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> {t("groups.newGroup")}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("groups.name")}</TableHead>
              <TableHead>{t("groups.description")}</TableHead>
              <TableHead>{t("groups.members")}</TableHead>
              <TableHead>{t("groups.allowedTools")}</TableHead>
              <TableHead>{t("groups.status")}</TableHead>
              <TableHead>{t("groups.created")}</TableHead>
              <TableHead className="text-right">{t("users.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  <Link to={`/admin/groups/${g.id}`} className="text-primary hover:underline font-medium">
                    {g.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-48 truncate">
                  {g.description || "-"}
                </TableCell>
                <TableCell>{g.memberCount}</TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  {g.allowedTools ? g.allowedTools.join(", ") : t("groups.allTools")}
                </TableCell>
                <TableCell>
                  <Badge variant={g.status === "active" ? "default" : "secondary"}>
                    {g.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(g.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="ghost" onClick={() => openEditDialog(g)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Switch
                    checked={g.status === "active"}
                    onCheckedChange={() => toggleStatus(g)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {t("groups.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create Group Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("groups.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("groups.nameRequired")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("groups.descriptionLabel")}</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("groups.allowedToolsLabel")}</Label>
              <ToolSelector value={form.allowedTools} onChange={(v) => setForm({ ...form, allowedTools: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreate} disabled={!form.name}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("groups.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("groups.nameRequired")}</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("groups.descriptionLabel")}</Label>
              <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("groups.allowedToolsLabel")}</Label>
              <ToolSelector value={editForm.allowedTools} onChange={(v) => setEditForm({ ...editForm, allowedTools: v })} />
            </div>
            <div className="flex items-center gap-2">
              <Label>{t("groups.activeLabel")}</Label>
              <Switch
                checked={editForm.status === "active"}
                onCheckedChange={(v) => setEditForm({ ...editForm, status: v ? "active" : "disabled" })}
              />
              <span className="text-sm text-muted-foreground">{editForm.status}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleEdit} disabled={!editForm.name}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
