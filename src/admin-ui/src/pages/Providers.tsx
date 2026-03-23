import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  createProfile,
  updateProfile,
  deleteProfile,
  reloadProviders,
  getUsageStats,
  getProfileStats,
} from "@/lib/api";
import type { McpProvider, McpProfile, UsageStats } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { KeyValueEditor } from "@/components/KeyValueEditor";

// --- Provider Form ---

interface ProviderForm {
  key: string;
  name: string;
  type: string;
  url: string;
  command: string;
  args: string;
  active: boolean;
}

const emptyProviderForm: ProviderForm = {
  key: "",
  name: "",
  type: "http",
  url: "",
  command: "",
  args: "",
  active: true,
};

// --- Profile Form ---

interface ProfileForm {
  key: string;
  active: boolean;
  url: string;
  headers: Record<string, string>;
  env: Record<string, string>;
}

const emptyProfileForm: ProfileForm = {
  key: "",
  active: true,
  url: "",
  headers: {},
  env: {},
};

// --- Main Page ---

export default function ProvidersPage() {
  const [providers, setProviders] = useState<McpProvider[]>([]);
  const [providerUsage, setProviderUsage] = useState<Record<string, { count: number; cost: number }>>({});
  const [profileStatsMap, setProfileStatsMap] = useState<Record<string, Record<string, { count: number; cost: number }>>>({}); // providerKey -> profileKey -> stats

  // Provider dialog
  const [providerOpen, setProviderOpen] = useState(false);
  const [editingProviderKey, setEditingProviderKey] = useState<string | null>(
    null
  );
  const [providerForm, setProviderForm] = useState<ProviderForm>({
    ...emptyProviderForm,
  });

  // Profile dialog
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingProfileContext, setEditingProfileContext] = useState<{
    providerKey: string;
    profileKey: string | null;
    providerType: string;
  } | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    ...emptyProfileForm,
  });

  const load = async () => {
    const res = await listProviders();
    const provs: McpProvider[] = res.data;
    setProviders(provs);
    // Load usage counts per provider
    const month = new Date();
    const billingMonth = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    const usage: Record<string, { count: number; cost: number }> = {};
    const pStats: Record<string, Record<string, { count: number; cost: number }>> = {};
    await Promise.all(
      provs.map(async (p) => {
        try {
          const r = await getUsageStats({ provider: p.key, billingMonth, limit: "1000" });
          const stats: UsageStats[] = r.data.data;
          const count = stats.reduce((s, u) => s + u.count, 0);
          const cost = stats.reduce((s, u) => s + u.totalCost, 0);
          usage[p.key] = { count, cost };
        } catch {
          usage[p.key] = { count: 0, cost: 0 };
        }
        try {
          const r = await getProfileStats(p.key, { billingMonth });
          const map: Record<string, { count: number; cost: number }> = {};
          for (const s of r.data as { profileKey: string; count: number; totalCost: number }[]) {
            map[s.profileKey] = { count: s.count, cost: s.totalCost };
          }
          pStats[p.key] = map;
        } catch {
          pStats[p.key] = {};
        }
      })
    );
    setProviderUsage(usage);
    setProfileStatsMap(pStats);
  };

  useEffect(() => {
    load();
  }, []);

  // --- Provider CRUD ---

  const openCreateProvider = () => {
    setEditingProviderKey(null);
    setProviderForm({ ...emptyProviderForm });
    setProviderOpen(true);
  };

  const openEditProvider = (p: McpProvider) => {
    setEditingProviderKey(p.key);
    setProviderForm({
      key: p.key,
      name: p.name || "",
      type: p.type,
      url: p.url || "",
      command: p.command || "",
      args: p.args?.join(" ") || "",
      active: p.active,
    });
    setProviderOpen(true);
  };

  const handleProviderSubmit = async () => {
    try {
      const data: Record<string, unknown> = {
        type: providerForm.type,
        name: providerForm.name || undefined,
        active: providerForm.active,
      };
      if (providerForm.type === "sse" || providerForm.type === "http") {
        data.url = providerForm.url;
      } else {
        data.command = providerForm.command;
        data.args = providerForm.args.split(" ").filter(Boolean);
      }

      if (editingProviderKey) {
        await updateProvider(editingProviderKey, data);
        toast.success("Provider updated");
      } else {
        data.key = providerForm.key;
        await createProvider(data);
        toast.success("Provider created");
      }
      setProviderOpen(false);
      load();
    } catch {
      toast.error(
        editingProviderKey
          ? "Failed to update provider"
          : "Failed to create provider"
      );
    }
  };

  const handleDeleteProvider = async (key: string) => {
    if (!confirm(`Delete provider "${key}" and all its profiles?`)) return;
    try {
      await deleteProvider(key);
      toast.success("Provider deleted");
      load();
    } catch {
      toast.error("Failed to delete provider");
    }
  };

  // --- Profile CRUD ---

  const openCreateProfile = (providerKey: string, providerType: string) => {
    setEditingProfileContext({ providerKey, profileKey: null, providerType });
    setProfileForm({ ...emptyProfileForm });
    setProfileOpen(true);
  };

  const openEditProfile = (
    providerKey: string,
    providerType: string,
    profile: McpProfile
  ) => {
    setEditingProfileContext({
      providerKey,
      profileKey: profile.key,
      providerType,
    });
    setProfileForm({
      key: profile.key,
      active: profile.active,
      url: profile.url || "",
      headers: profile.headers ? { ...profile.headers } : {},
      env: profile.env ? { ...profile.env } : {},
    });
    setProfileOpen(true);
  };

  const handleProfileSubmit = async () => {
    if (!editingProfileContext) return;
    const { providerKey, profileKey, providerType } = editingProfileContext;
    try {
      const data: Record<string, unknown> = {
        active: profileForm.active,
      };
      if (providerType === "sse" || providerType === "http") {
        if (profileForm.url) data.url = profileForm.url;
        if (Object.keys(profileForm.headers).length > 0)
          data.headers = profileForm.headers;
      } else {
        if (Object.keys(profileForm.env).length > 0)
          data.env = profileForm.env;
      }

      if (profileKey) {
        await updateProfile(providerKey, profileKey, data);
        toast.success("Profile updated");
      } else {
        data.key = profileForm.key;
        await createProfile(providerKey, data);
        toast.success("Profile created");
      }
      setProfileOpen(false);
      load();
    } catch {
      toast.error(
        profileKey
          ? "Failed to update profile"
          : "Failed to create profile"
      );
    }
  };

  const handleDeleteProfile = async (
    providerKey: string,
    profileKey: string
  ) => {
    if (!confirm(`Delete profile "${profileKey}"?`)) return;
    try {
      await deleteProfile(providerKey, profileKey);
      toast.success("Profile deleted");
      load();
    } catch {
      toast.error("Failed to delete profile");
    }
  };

  // --- Reload ---

  const handleReload = async () => {
    try {
      await reloadProviders();
      toast.success("Providers reloaded");
      load();
    } catch {
      toast.error("Failed to reload");
    }
  };

  // --- Render ---

  const isProviderFormValid = editingProviderKey
    ? true
    : !!providerForm.key;
  const isProfileFormValid = editingProfileContext?.profileKey
    ? true
    : !!profileForm.key;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Providers</h2>
        <div className="flex gap-2">
          <Button onClick={openCreateProvider}>
            <Plus className="h-4 w-4 mr-2" /> Add Provider
          </Button>
          <Button variant="outline" onClick={handleReload}>
            <RefreshCw className="h-4 w-4 mr-2" /> Apply Config
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {providers.map((p) => (
          <Card key={p.key}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to={`/admin/providers/${p.key}`} className="font-semibold text-primary hover:underline">
                    {p.name || p.key}
                  </Link>
                  {p.url && <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.url}</code>}
                  {p.command && <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.command} {p.args?.join(" ")}</code>}
                  <Badge variant="outline">{p.type}</Badge>
                  <Badge variant={p.active ? "default" : "secondary"}>
                    {p.active ? "active" : "inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEditProvider(p)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDeleteProvider(p.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Schema errors */}
              {p.schemaErrors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Schema Validation Errors</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                      {p.schemaErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Summary stats */}
              <div className="flex items-center gap-6 text-sm">
                <span className="text-muted-foreground">
                  Tools: <span className="text-foreground font-medium">{p.tools.length}</span>
                </span>
                {providerUsage[p.key] && (
                  <>
                    <span className="text-muted-foreground">
                      Calls (this month): <span className="text-foreground font-medium">{providerUsage[p.key].count}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Cost: <span className="text-foreground font-medium">{providerUsage[p.key].cost.toFixed(4)}</span>
                    </span>
                  </>
                )}
              </div>

              {/* Profiles */}
              <div>
                {p.profiles.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Profile</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>URL Override</TableHead>
                        <TableHead>Config</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.profiles.map((profile) => (
                        <TableRow key={profile.key}>
                          <TableCell className="font-mono text-sm">
                            {profile.key}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                profile.status === "connected"
                                  ? "default"
                                  : "secondary"
                              }
                              className="text-xs"
                            >
                              {profile.status}
                            </Badge>
                            {!profile.active && (
                              <Badge
                                variant="outline"
                                className="text-xs ml-1"
                              >
                                inactive
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {profile.url || "-"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {profile.headers &&
                              Object.keys(profile.headers).length > 0 &&
                              `${Object.keys(profile.headers).length} headers`}
                            {profile.env &&
                              Object.keys(profile.env).length > 0 &&
                              `${Object.keys(profile.env).length} env vars`}
                            {!profile.headers &&
                              !profile.env &&
                              "-"}
                            {profile.headers &&
                              Object.keys(profile.headers).length === 0 &&
                              (!profile.env ||
                                Object.keys(profile.env).length === 0) &&
                              "-"}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {profileStatsMap[p.key]?.[profile.key]?.count ?? 0}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {(profileStatsMap[p.key]?.[profile.key]?.cost ?? 0).toFixed(4)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() =>
                                  openEditProfile(p.key, p.type, profile)
                                }
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={() =>
                                  handleDeleteProfile(p.key, profile.key)
                                }
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <div className="flex items-center justify-between mb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => openCreateProfile(p.key, p.type)}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add Profile
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {providers.length === 0 && (
          <p className="text-muted-foreground text-center py-8">
            No providers configured
          </p>
        )}
      </div>

      {/* Provider Dialog */}
      <Dialog open={providerOpen} onOpenChange={setProviderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProviderKey ? "Edit Provider" : "Add Provider"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Key *</Label>
              <Input
                value={providerForm.key}
                onChange={(e) =>
                  setProviderForm({ ...providerForm, key: e.target.value })
                }
                placeholder="unique-provider-key"
                disabled={!!editingProviderKey}
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={providerForm.name}
                onChange={(e) =>
                  setProviderForm({ ...providerForm, name: e.target.value })
                }
                placeholder="Display name (optional)"
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={providerForm.type}
                onValueChange={(v) => {
                  if (v)
                    setProviderForm({ ...providerForm, type: v });
                }}
                disabled={!!editingProviderKey}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP (Streamable)</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                  <SelectItem value="stdio">Stdio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(providerForm.type === "sse" ||
              providerForm.type === "http") && (
              <div className="space-y-2">
                <Label>Base URL *</Label>
                <Input
                  value={providerForm.url}
                  onChange={(e) =>
                    setProviderForm({ ...providerForm, url: e.target.value })
                  }
                  placeholder="https://example.com/mcp"
                />
              </div>
            )}
            {providerForm.type === "stdio" && (
              <>
                <div className="space-y-2">
                  <Label>Command *</Label>
                  <Input
                    value={providerForm.command}
                    onChange={(e) =>
                      setProviderForm({
                        ...providerForm,
                        command: e.target.value,
                      })
                    }
                    placeholder="node"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Args (space-separated)</Label>
                  <Input
                    value={providerForm.args}
                    onChange={(e) =>
                      setProviderForm({
                        ...providerForm,
                        args: e.target.value,
                      })
                    }
                    placeholder="server.js --port 8080"
                  />
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={providerForm.active}
                onCheckedChange={(checked) =>
                  setProviderForm({ ...providerForm, active: checked })
                }
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProviderOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleProviderSubmit}
              disabled={!isProviderFormValid}
            >
              {editingProviderKey ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Profile Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProfileContext?.profileKey
                ? "Edit Profile"
                : "Add Profile"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Profile Key *</Label>
              <Input
                value={profileForm.key}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, key: e.target.value })
                }
                placeholder="profile-key"
                disabled={!!editingProfileContext?.profileKey}
              />
            </div>
            {editingProfileContext &&
              (editingProfileContext.providerType === "sse" ||
                editingProfileContext.providerType === "http") && (
                <>
                  <div className="space-y-2">
                    <Label>URL Override</Label>
                    <Input
                      value={profileForm.url}
                      onChange={(e) =>
                        setProfileForm({
                          ...profileForm,
                          url: e.target.value,
                        })
                      }
                      placeholder="Leave empty to use provider URL"
                    />
                  </div>
                  <KeyValueEditor
                    label="Custom Headers"
                    value={profileForm.headers}
                    onChange={(headers) =>
                      setProfileForm({ ...profileForm, headers })
                    }
                    keyPlaceholder="Header name"
                    valuePlaceholder="Header value"
                  />
                </>
              )}
            {editingProfileContext &&
              editingProfileContext.providerType === "stdio" && (
                <KeyValueEditor
                  label="Environment Variables"
                  value={profileForm.env}
                  onChange={(env) =>
                    setProfileForm({ ...profileForm, env })
                  }
                  keyPlaceholder="Variable name"
                  valuePlaceholder="Variable value"
                />
              )}
            <div className="flex items-center gap-2">
              <Switch
                checked={profileForm.active}
                onCheckedChange={(checked) =>
                  setProfileForm({ ...profileForm, active: checked })
                }
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleProfileSubmit}
              disabled={!isProfileFormValid}
            >
              {editingProfileContext?.profileKey ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
