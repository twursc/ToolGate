import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getUser, listApiKeys, createApiKey, updateApiKey, deleteApiKey, getUserUsage, regenerateApiKey } from "@/lib/api";
import type { User, ApiKey } from "@/lib/types";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Plus, Copy, Trash2, Pencil } from "lucide-react";

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", quota: "0" });
  const [newKey, setNewKey] = useState("");
  const [usage, setUsage] = useState<{ toolName: string; count: number; totalCost: number }[]>([]);
  const [usageMonth, setUsageMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState<ApiKey | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    quota: "0",
    balance: "-1",
    allowedTools: "",
    status: "active" as "active" | "disabled",
  });
  const [regenerate, setRegenerate] = useState(false);
  const [regeneratedKey, setRegeneratedKey] = useState("");

  const loadUser = () => {
    if (!id) return;
    getUser(id).then((r) => setUser(r.data));
    listApiKeys(id).then((r) => setKeys(r.data));
  };

  const loadUsage = (month?: string) => {
    if (!id) return;
    getUserUsage(id, { billingMonth: month ?? usageMonth }).then((r) => setUsage(r.data));
  };

  useEffect(() => { loadUser(); loadUsage(); }, [id]);

  const handleCreateKey = async () => {
    if (!id) return;
    try {
      const res = await createApiKey(id, { name: createForm.name, quota: Number(createForm.quota) });
      setNewKey(res.data.key || "");
      toast.success("API Key created");
      setCreateForm({ name: "", quota: "0" });
      loadUser();
    } catch {
      toast.error("Failed to create API Key");
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm("Are you sure you want to delete this API Key?")) return;
    await deleteApiKey(keyId);
    toast.success("API Key deleted");
    loadUser();
  };

  const toggleKeyStatus = async (key: ApiKey) => {
    const newStatus = key.status === "active" ? "disabled" : "active";
    await updateApiKey(key.id, { status: newStatus });
    toast.success(`API Key ${newStatus}`);
    loadUser();
  };

  const openEditDialog = (key: ApiKey) => {
    setEditKey(key);
    setEditForm({
      name: key.name,
      quota: String(key.quota),
      balance: String(key.balance),
      allowedTools: key.allowedTools ? key.allowedTools.join(", ") : "",
      status: key.status,
    });
    setRegenerate(false);
    setRegeneratedKey("");
    setEditOpen(true);
  };

  const handleEditSubmit = async () => {
    if (!editKey) return;
    try {
      const allowedToolsArr = editForm.allowedTools.trim()
        ? editForm.allowedTools.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

      await updateApiKey(editKey.id, {
        name: editForm.name,
        quota: Number(editForm.quota),
        balance: Number(editForm.balance),
        allowedTools: allowedToolsArr,
        status: editForm.status,
      });

      if (regenerate) {
        const res = await regenerateApiKey(editKey.id);
        setRegeneratedKey(res.data.key);
        toast.success("API Key updated and regenerated");
      } else {
        toast.success("API Key updated");
        setEditOpen(false);
      }
      loadUser();
    } catch {
      toast.error("Failed to update API Key");
    }
  };

  if (!user) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div>
      <Button variant="ghost" className="mb-4" onClick={() => navigate("/admin/users")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to Users
      </Button>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {user.username}
            <Badge variant={user.status === "active" ? "default" : "secondary"}>
              {user.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Email:</span> {user.email || "-"}</div>
          <div><span className="text-muted-foreground">Note:</span> {user.note || "-"}</div>
          <div><span className="text-muted-foreground">Created:</span> {new Date(user.createdAt).toLocaleString()}</div>
          <div><span className="text-muted-foreground">Updated:</span> {new Date(user.updatedAt).toLocaleString()}</div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Tool Usage</CardTitle>
            <div className="flex items-center gap-2">
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
        </CardHeader>
        <CardContent>
          {usage.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool Name</TableHead>
                    <TableHead className="text-right">Call Count</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((u) => (
                    <TableRow key={u.toolName}>
                      <TableCell>{u.toolName}</TableCell>
                      <TableCell className="text-right">{u.count}</TableCell>
                      <TableCell className="text-right">{u.totalCost.toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-muted/50">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{usage.reduce((s, u) => s + u.count, 0)}</TableCell>
                    <TableCell className="text-right">{usage.reduce((s, u) => s + u.totalCost, 0).toFixed(4)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No usage data for this month</p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">API Keys</h3>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New API Key
        </Button>
      </div>

      {newKey && (
        <div className="mb-4 p-4 rounded-md border bg-muted">
          <p className="text-sm font-medium mb-2">New API Key (copy now, it won't be shown again):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-background p-2 rounded border break-all">{newKey}</code>
            <Button size="sm" variant="outline" onClick={() => handleCopy(newKey)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setNewKey("")}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Quota</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell><code className="text-xs">{k.keyPrefix}...</code></TableCell>
                <TableCell>{k.quota === 0 ? "Unlimited" : k.quota}</TableCell>
                <TableCell>{k.balance < 0 ? "Unlimited" : k.balance.toFixed(4)}</TableCell>
                <TableCell>
                  <Badge variant={k.status === "active" ? "default" : "secondary"}>
                    {k.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never"}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="ghost" onClick={() => openEditDialog(k)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Switch
                    checked={k.status === "active"}
                    onCheckedChange={() => toggleKeyStatus(k)}
                  />
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteKey(k.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {keys.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No API Keys
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create API Key Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Quota (0 = unlimited)</Label>
              <Input type="number" value={createForm.quota} onChange={(e) => setCreateForm({ ...createForm, quota: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateKey} disabled={!createForm.name}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit API Key Dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { if (!v) { setEditOpen(false); setRegeneratedKey(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit API Key</DialogTitle>
          </DialogHeader>
          {regeneratedKey ? (
            <div className="space-y-4">
              <p className="text-sm font-medium">New API Key (copy now, it won't be shown again):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm bg-muted p-2 rounded border break-all">{regeneratedKey}</code>
                <Button size="sm" variant="outline" onClick={() => handleCopy(regeneratedKey)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => { setEditOpen(false); setRegeneratedKey(""); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Quota (0 = unlimited)</Label>
                    <Input type="number" value={editForm.quota} onChange={(e) => setEditForm({ ...editForm, quota: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Balance (-1 = unlimited)</Label>
                    <Input type="number" step="0.0001" value={editForm.balance} onChange={(e) => setEditForm({ ...editForm, balance: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Allowed Tools (comma-separated, empty = all)</Label>
                  <Textarea
                    rows={3}
                    placeholder="provider__tool1, provider__tool2"
                    value={editForm.allowedTools}
                    onChange={(e) => setEditForm({ ...editForm, allowedTools: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label>Status</Label>
                  <Switch
                    checked={editForm.status === "active"}
                    onCheckedChange={(v) => setEditForm({ ...editForm, status: v ? "active" : "disabled" })}
                  />
                  <span className="text-sm text-muted-foreground">{editForm.status}</span>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Checkbox
                    id="regenerate"
                    checked={regenerate}
                    onCheckedChange={(v) => setRegenerate(!!v)}
                  />
                  <Label htmlFor="regenerate" className="text-sm font-normal cursor-pointer">
                    Regenerate API Key (will invalidate the current key)
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button onClick={handleEditSubmit}>Save</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
