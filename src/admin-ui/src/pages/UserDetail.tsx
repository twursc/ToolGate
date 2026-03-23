import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getUser, listApiKeys, createApiKey, updateApiKey, deleteApiKey } from "@/lib/api";
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
import { toast } from "sonner";
import { ArrowLeft, Plus, Copy, Trash2 } from "lucide-react";

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", quota: "0" });
  const [newKey, setNewKey] = useState("");

  const loadUser = () => {
    if (!id) return;
    getUser(id).then((r) => setUser(r.data));
    listApiKeys(id).then((r) => setKeys(r.data));
  };

  useEffect(() => { loadUser(); }, [id]);

  const handleCreateKey = async () => {
    if (!id) return;
    try {
      const res = await createApiKey(id, { name: form.name, quota: Number(form.quota) });
      setNewKey(res.data.key || "");
      toast.success("API Key created");
      setForm({ name: "", quota: "0" });
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

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">API Keys</h3>
        <Button onClick={() => setOpen(true)}>
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
                <TableCell>
                  <Badge variant={k.status === "active" ? "default" : "secondary"}>
                    {k.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never"}
                </TableCell>
                <TableCell className="text-right space-x-2">
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
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No API Keys
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Quota (0 = unlimited)</Label>
              <Input type="number" value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateKey} disabled={!form.name}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
