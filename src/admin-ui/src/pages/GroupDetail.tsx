import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getGroup, updateGroup, deleteGroup, addGroupMembers, removeGroupMember, listUsers } from "@/lib/api";
import type { GroupDetail, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Trash2, UserPlus } from "lucide-react";

export default function GroupDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupDetail | null>(null);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    allowedTools: "",
    status: "active" as "active" | "disabled",
  });

  // Add members dialog
  const [addOpen, setAddOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const load = () => {
    if (!id) return;
    getGroup(id).then((r) => setGroup(r.data));
  };

  useEffect(() => { load(); }, [id]);

  const openEditDialog = () => {
    if (!group) return;
    setEditForm({
      name: group.name,
      description: group.description || "",
      allowedTools: group.allowedTools ? group.allowedTools.join(", ") : "",
      status: group.status,
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!id) return;
    try {
      const allowedTools = editForm.allowedTools.trim()
        ? editForm.allowedTools.split(",").map((s) => s.trim()).filter(Boolean)
        : null;
      await updateGroup(id, {
        name: editForm.name,
        description: editForm.description || null,
        allowedTools,
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

  const handleDelete = async () => {
    if (!group || !id) return;
    if (!confirm(t("groupDetail.confirmDelete", { name: group.name }))) return;
    try {
      await deleteGroup(id);
      toast.success(t("groups.toast.deleted"));
      navigate("/admin/groups");
    } catch {
      toast.error(t("groups.toast.deleteFailed"));
    }
  };

  const openAddMembers = async () => {
    const res = await listUsers(500);
    const memberIds = new Set(group?.members.map((m) => m.userId) || []);
    setAllUsers(res.data.filter((u: User) => !memberIds.has(u.id)));
    setSelectedUserIds([]);
    setAddOpen(true);
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleAddMembers = async () => {
    if (!id || selectedUserIds.length === 0) return;
    try {
      await addGroupMembers(id, selectedUserIds);
      toast.success(t("groupDetail.toast.membersAdded"));
      setAddOpen(false);
      load();
    } catch {
      toast.error(t("groupDetail.toast.addFailed"));
    }
  };

  const handleRemoveMember = async (userId: string, username: string) => {
    if (!id) return;
    if (!confirm(t("groupDetail.confirmRemove", { name: username }))) return;
    try {
      await removeGroupMember(id, userId);
      toast.success(t("groupDetail.toast.memberRemoved"));
      load();
    } catch {
      toast.error(t("groupDetail.toast.removeFailed"));
    }
  };

  if (!group) return <div className="text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div>
      <Button variant="ghost" className="mb-4" onClick={() => navigate("/admin/groups")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> {t("groupDetail.backToGroups")}
      </Button>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3">
              {group.name}
              <Badge variant={group.status === "active" ? "default" : "secondary"}>
                {group.status}
              </Badge>
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={openEditDialog}>
                <Pencil className="h-4 w-4 mr-1" /> {t("common.save").replace(/^./, "")}
              </Button>
              <Button size="sm" variant="destructive" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">{t("groupDetail.descriptionLabel")}</span> {group.description || "-"}</div>
          <div>
            <span className="text-muted-foreground">{t("groupDetail.allowedToolsLabel")}</span>{" "}
            {group.allowedTools ? group.allowedTools.join(", ") : t("groupDetail.allTools")}
          </div>
          <div><span className="text-muted-foreground">{t("groupDetail.createdLabel")}</span> {new Date(group.createdAt).toLocaleString()}</div>
          <div><span className="text-muted-foreground">{t("groupDetail.updatedLabel")}</span> {new Date(group.updatedAt).toLocaleString()}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("groupDetail.membersTitle", { count: group.members.length })}</CardTitle>
            <Button size="sm" onClick={openAddMembers}>
              <UserPlus className="h-4 w-4 mr-2" /> {t("groupDetail.addMembers")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("groupDetail.username")}</TableHead>
                  <TableHead>{t("groupDetail.email")}</TableHead>
                  <TableHead>{t("groupDetail.status")}</TableHead>
                  <TableHead>{t("groupDetail.joined")}</TableHead>
                  <TableHead className="text-right">{t("groupDetail.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <Link to={`/admin/users/${m.userId}`} className="text-primary hover:underline font-medium">
                        {m.username}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.email || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={m.status === "active" ? "default" : "secondary"}>
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(m.joinedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => handleRemoveMember(m.userId, m.username)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {group.members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      {t("groupDetail.noMembers")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Group Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
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
              <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("groups.allowedToolsLabel")}</Label>
              <Textarea value={editForm.allowedTools} onChange={(e) => setEditForm({ ...editForm, allowedTools: e.target.value })} />
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

      {/* Add Members Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("groupDetail.addMembers")}</DialogTitle>
          </DialogHeader>
          {allUsers.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">{t("groupDetail.noUsersToAdd")}</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              <p className="text-sm text-muted-foreground mb-2">{t("groupDetail.selectUsers")}</p>
              {allUsers.map((u) => (
                <div key={u.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted">
                  <Checkbox
                    checked={selectedUserIds.includes(u.id)}
                    onCheckedChange={() => toggleUserSelection(u.id)}
                  />
                  <span className="text-sm font-medium">{u.username}</span>
                  <span className="text-sm text-muted-foreground">{u.email || ""}</span>
                  <Badge variant={u.status === "active" ? "default" : "secondary"} className="ml-auto">
                    {u.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleAddMembers} disabled={selectedUserIds.length === 0}>
              {t("common.add")} ({selectedUserIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
