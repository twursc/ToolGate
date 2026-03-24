import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getUser, listApiKeys, createApiKey, updateApiKey, deleteApiKey, getUserUsage, regenerateApiKey, listConnectionLogs } from "@/lib/api";
import type { User, ApiKey, ConnectionLog, UserGroup } from "@/lib/types";
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
import ToolSelector from "@/components/ToolSelector";
import { toast } from "sonner";
import { ArrowLeft, Plus, Copy, Trash2, Pencil, Wifi, WifiOff } from "lucide-react";

export default function UserDetail() {
  const { t } = useTranslation();
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
    allowedTools: null as string[] | null,
    status: "active" as "active" | "disabled",
  });
  const [regenerate, setRegenerate] = useState(false);
  const [regeneratedKey, setRegeneratedKey] = useState("");

  // User groups
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);

  // Connection logs state
  const [connections, setConnections] = useState<ConnectionLog[]>([]);
  const [connTotal, setConnTotal] = useState(0);
  const [connOnlineOnly, setConnOnlineOnly] = useState(true);

  const loadUser = () => {
    if (!id) return;
    getUser(id).then((r) => {
      setUser(r.data);
      setUserGroups(r.data.groups || []);
    });
    listApiKeys(id).then((r) => setKeys(r.data));
  };

  const loadUsage = (month?: string) => {
    if (!id) return;
    getUserUsage(id, { billingMonth: month ?? usageMonth }).then((r) => setUsage(r.data));
  };

  const loadConnections = (onlineOnly?: boolean) => {
    if (!id) return;
    const status = (onlineOnly ?? connOnlineOnly) ? "online" : "all";
    listConnectionLogs(id, { status, limit: "100" }).then((r) => {
      setConnections(r.data.data);
      setConnTotal(r.data.total);
    });
  };

  useEffect(() => { loadUser(); loadUsage(); loadConnections(); }, [id]);

  // Auto-refresh connections every 30s when viewing online only
  useEffect(() => {
    if (!connOnlineOnly) return;
    const interval = setInterval(() => loadConnections(true), 30000);
    return () => clearInterval(interval);
  }, [id, connOnlineOnly]);

  const handleCreateKey = async () => {
    if (!id) return;
    try {
      const res = await createApiKey(id, { name: createForm.name, quota: Number(createForm.quota) });
      setNewKey(res.data.key || "");
      toast.success(t("userDetail.toast.keyCreated"));
      setCreateOpen(false);
      setCreateForm({ name: "", quota: "0" });
      loadUser();
    } catch {
      toast.error(t("userDetail.toast.createKeyFailed"));
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("userDetail.toast.copied"));
  };

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm(t("userDetail.confirmDeleteKey"))) return;
    await deleteApiKey(keyId);
    toast.success(t("userDetail.toast.keyDeleted"));
    loadUser();
  };

  const toggleKeyStatus = async (key: ApiKey) => {
    const newStatus = key.status === "active" ? "disabled" : "active";
    await updateApiKey(key.id, { status: newStatus });
    toast.success(t("userDetail.toast.keyStatusChanged", { status: newStatus }));
    loadUser();
  };

  const openEditDialog = (key: ApiKey) => {
    setEditKey(key);
    setEditForm({
      name: key.name,
      quota: String(key.quota),
      balance: String(key.balance),
      allowedTools: key.allowedTools ?? null,
      status: key.status,
    });
    setRegenerate(false);
    setRegeneratedKey("");
    setEditOpen(true);
  };

  const handleEditSubmit = async () => {
    if (!editKey) return;
    try {
      await updateApiKey(editKey.id, {
        name: editForm.name,
        quota: Number(editForm.quota),
        balance: Number(editForm.balance),
        allowedTools: editForm.allowedTools,
        status: editForm.status,
      });

      if (regenerate) {
        const res = await regenerateApiKey(editKey.id);
        setRegeneratedKey(res.data.key);
        toast.success(t("userDetail.toast.keyRegenerated"));
      } else {
        toast.success(t("userDetail.toast.keyUpdated"));
        setEditOpen(false);
      }
      loadUser();
    } catch {
      toast.error(t("userDetail.toast.updateKeyFailed"));
    }
  };

  if (!user) return <div className="text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div>
      <Button variant="ghost" className="mb-4" onClick={() => navigate("/admin/users")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> {t("userDetail.backToUsers")}
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
          <div><span className="text-muted-foreground">{t("userDetail.emailLabel")}</span> {user.email || "-"}</div>
          <div><span className="text-muted-foreground">{t("userDetail.noteLabel")}</span> {user.note || "-"}</div>
          <div><span className="text-muted-foreground">{t("userDetail.createdLabel")}</span> {new Date(user.createdAt).toLocaleString()}</div>
          <div><span className="text-muted-foreground">{t("userDetail.updatedLabel")}</span> {new Date(user.updatedAt).toLocaleString()}</div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("userDetail.groups")}</CardTitle>
        </CardHeader>
        <CardContent>
          {userGroups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {userGroups.map((g) => (
                <Link key={g.id} to={`/admin/groups/${g.id}`}>
                  <Badge variant={g.status === "active" ? "default" : "secondary"} className="cursor-pointer hover:opacity-80">
                    {g.name}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("userDetail.noGroups")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("userDetail.toolUsage")}</CardTitle>
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
                    <TableHead>{t("userDetail.toolName")}</TableHead>
                    <TableHead className="text-right">{t("userDetail.callCount")}</TableHead>
                    <TableHead className="text-right">{t("userDetail.totalCost")}</TableHead>
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
                    <TableCell>{t("common.total")}</TableCell>
                    <TableCell className="text-right">{usage.reduce((s, u) => s + u.count, 0)}</TableCell>
                    <TableCell className="text-right">{usage.reduce((s, u) => s + u.totalCost, 0).toFixed(4)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("userDetail.noUsage")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("userDetail.connections")} ({connTotal})</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next = !connOnlineOnly;
                setConnOnlineOnly(next);
                loadConnections(next);
              }}
            >
              {connOnlineOnly ? <Wifi className="h-4 w-4 mr-2" /> : <WifiOff className="h-4 w-4 mr-2" />}
              {connOnlineOnly ? t("userDetail.connectionsShowAll") : t("userDetail.connectionsOnlineOnly")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {connections.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("userDetail.connStatus")}</TableHead>
                    <TableHead>{t("userDetail.connApiKey")}</TableHead>
                    <TableHead>{t("userDetail.connClient")}</TableHead>
                    <TableHead>{t("userDetail.connIpAddress")}</TableHead>
                    <TableHead>{t("userDetail.connTransport")}</TableHead>
                    <TableHead>{t("userDetail.connConnectedAt")}</TableHead>
                    <TableHead>{t("userDetail.connDisconnectedAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 rounded-full ${c.status === "online" ? "bg-green-500" : "bg-gray-400"}`} />
                          {c.status === "online" ? t("userDetail.connOnline") : t("userDetail.connOffline")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{c.apiKeyName ?? "-"}</span>
                        {c.apiKeyPrefix && <code className="ml-1 text-xs text-muted-foreground">{c.apiKeyPrefix}...</code>}
                      </TableCell>
                      <TableCell>
                        <span title={c.userAgent ?? undefined}>
                          {c.clientName
                            ? `${c.clientName}${c.clientVersion ? ` v${c.clientVersion}` : ""}`
                            : t("userDetail.connUnknownClient")}
                        </span>
                      </TableCell>
                      <TableCell><code className="text-xs">{c.ipAddress ?? "-"}</code></TableCell>
                      <TableCell>
                        <Badge variant="outline">{c.transportType.toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(c.connectedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {c.disconnectedAt ? new Date(c.disconnectedAt).toLocaleString() : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("userDetail.connNoData")}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t("userDetail.apiKeys")}</h3>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> {t("userDetail.newApiKey")}
        </Button>
      </div>

      {newKey && (
        <div className="mb-4 p-4 rounded-md border bg-muted">
          <p className="text-sm font-medium mb-2">{t("userDetail.newKeyNotice")}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-background p-2 rounded border break-all">{newKey}</code>
            <Button size="sm" variant="outline" onClick={() => handleCopy(newKey)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setNewKey("")}>
            {t("common.dismiss")}
          </Button>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("userDetail.keyName")}</TableHead>
              <TableHead>{t("userDetail.keyPrefix")}</TableHead>
              <TableHead>{t("userDetail.keyQuota")}</TableHead>
              <TableHead>{t("userDetail.keyBalance")}</TableHead>
              <TableHead>{t("userDetail.keyStatus")}</TableHead>
              <TableHead>{t("userDetail.keyExpires")}</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell><code className="text-xs">{k.keyPrefix}...</code></TableCell>
                <TableCell>{k.quota === 0 ? t("common.unlimited") : k.quota}</TableCell>
                <TableCell>{k.balance < 0 ? t("common.unlimited") : k.balance.toFixed(4)}</TableCell>
                <TableCell>
                  <Badge variant={k.status === "active" ? "default" : "secondary"}>
                    {k.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : t("common.never")}
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
                  {t("userDetail.noKeys")}
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
            <DialogTitle>{t("userDetail.createKeyTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("userDetail.nameRequired")}</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("userDetail.quotaLabel")}</Label>
              <Input type="number" value={createForm.quota} onChange={(e) => setCreateForm({ ...createForm, quota: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreateKey} disabled={!createForm.name}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit API Key Dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { if (!v) { setEditOpen(false); setRegeneratedKey(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("userDetail.editKeyTitle")}</DialogTitle>
          </DialogHeader>
          {regeneratedKey ? (
            <div className="space-y-4">
              <p className="text-sm font-medium">{t("userDetail.newKeyNotice")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm bg-muted p-2 rounded border break-all">{regeneratedKey}</code>
                <Button size="sm" variant="outline" onClick={() => handleCopy(regeneratedKey)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => { setEditOpen(false); setRegeneratedKey(""); }}>{t("common.done")}</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("userDetail.keyName")}</Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("userDetail.quotaLabel")}</Label>
                    <Input type="number" value={editForm.quota} onChange={(e) => setEditForm({ ...editForm, quota: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("userDetail.balanceLabel")}</Label>
                    <Input type="number" step="0.0001" value={editForm.balance} onChange={(e) => setEditForm({ ...editForm, balance: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label>{t("userDetail.statusLabel")}</Label>
                  <Switch
                    checked={editForm.status === "active"}
                    onCheckedChange={(v) => setEditForm({ ...editForm, status: v ? "active" : "disabled" })}
                  />
                  <span className="text-sm text-muted-foreground">{editForm.status}</span>
                </div>
                <div className="space-y-2 pt-4 border-t">
                  <Label style={{ fontWeight: 'bold' }}>{t("userDetail.allowedToolsLabel")}</Label>
                  <ToolSelector
                    value={editForm.allowedTools}
                    onChange={(v) => setEditForm({ ...editForm, allowedTools: v })}
                  />
                </div>
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Checkbox
                    id="regenerate"
                    checked={regenerate}
                    onCheckedChange={(v) => setRegenerate(!!v)}
                  />
                  <Label htmlFor="regenerate" className="text-sm font-normal cursor-pointer">
                    {t("userDetail.regenerateKey")}
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>{t("common.cancel")}</Button>
                <Button onClick={handleEditSubmit}>{t("common.save")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
