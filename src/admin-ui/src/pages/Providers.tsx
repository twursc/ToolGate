import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Textarea } from "@/components/ui/textarea";
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
  cbEnabled: boolean;
  cbFailureThreshold: number;
  cbFailureStatusCodes: string;
  cbTripOnContent: string;
  cbCooldownSeconds: number;
}

const emptyProviderForm: ProviderForm = {
  key: "",
  name: "",
  type: "http",
  url: "",
  command: "",
  args: "",
  active: true,
  cbEnabled: false,
  cbFailureThreshold: 5,
  cbFailureStatusCodes: "429, 500, 502, 503",
  cbTripOnContent: "",
  cbCooldownSeconds: 60,
};

// --- Profile Form ---

interface ProfileForm {
  key: string;
  active: boolean;
  url: string;
  headers: Record<string, string>;
  env: Record<string, string>;
  monthlyBudget: number;
}

const emptyProfileForm: ProfileForm = {
  key: "",
  active: true,
  url: "",
  headers: {},
  env: {},
  monthlyBudget: 0,
};

// --- Main Page ---

export default function ProvidersPage() {
  const { t } = useTranslation();
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
    const cb = p.circuitBreaker;
    setProviderForm({
      key: p.key,
      name: p.name || "",
      type: p.type,
      url: p.url || "",
      command: p.command || "",
      args: p.args?.join(" ") || "",
      active: p.active,
      cbEnabled: cb?.enabled ?? false,
      cbFailureThreshold: cb?.failureThreshold ?? 5,
      cbFailureStatusCodes: cb?.failureStatusCodes?.join(", ") ?? "429, 500, 502, 503",
      cbTripOnContent: cb?.tripOnContent?.join("\n") ?? "",
      cbCooldownSeconds: cb?.cooldownSeconds ?? 60,
    });
    setProviderOpen(true);
  };

  const handleProviderSubmit = async () => {
    try {
      const data: Record<string, unknown> = {
        type: providerForm.type,
        name: providerForm.name || undefined,
        active: providerForm.active,
        circuitBreaker: {
          enabled: providerForm.cbEnabled,
          failureThreshold: providerForm.cbFailureThreshold,
          failureStatusCodes: providerForm.cbFailureStatusCodes
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n)),
          tripOnContent: providerForm.cbTripOnContent
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          cooldownSeconds: providerForm.cbCooldownSeconds,
        },
      };
      if (providerForm.type === "sse" || providerForm.type === "http") {
        data.url = providerForm.url;
      } else {
        data.command = providerForm.command;
        data.args = providerForm.args.split(" ").filter(Boolean);
      }

      if (editingProviderKey) {
        await updateProvider(editingProviderKey, data);
        toast.success(t("providers.toast.updated"));
      } else {
        data.key = providerForm.key;
        await createProvider(data);
        toast.success(t("providers.toast.created"));
      }
      setProviderOpen(false);
      load();
    } catch {
      toast.error(
        editingProviderKey
          ? t("providers.toast.updateFailed")
          : t("providers.toast.createFailed")
      );
    }
  };

  const handleDeleteProvider = async (key: string) => {
    if (!confirm(t("providers.confirmDelete", { key }))) return;
    try {
      await deleteProvider(key);
      toast.success(t("providers.toast.deleted"));
      load();
    } catch {
      toast.error(t("providers.toast.deleteFailed"));
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
      monthlyBudget: profile.monthlyBudget ?? 0,
    });
    setProfileOpen(true);
  };

  const handleProfileSubmit = async () => {
    if (!editingProfileContext) return;
    const { providerKey, profileKey, providerType } = editingProfileContext;
    try {
      const data: Record<string, unknown> = {
        active: profileForm.active,
        monthlyBudget: profileForm.monthlyBudget || 0,
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
        toast.success(t("providers.toast.profileUpdated"));
      } else {
        data.key = profileForm.key;
        await createProfile(providerKey, data);
        toast.success(t("providers.toast.profileCreated"));
      }
      setProfileOpen(false);
      load();
    } catch {
      toast.error(
        profileKey
          ? t("providers.toast.profileUpdateFailed")
          : t("providers.toast.profileCreateFailed")
      );
    }
  };

  const handleDeleteProfile = async (
    providerKey: string,
    profileKey: string
  ) => {
    if (!confirm(t("providers.confirmDeleteProfile", { key: profileKey }))) return;
    try {
      await deleteProfile(providerKey, profileKey);
      toast.success(t("providers.toast.profileDeleted"));
      load();
    } catch {
      toast.error(t("providers.toast.profileDeleteFailed"));
    }
  };

  // --- Reload ---

  const [reloading, setReloading] = useState(false);

  const handleReload = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      await reloadProviders();
      toast.success(t("providers.toast.reloaded"));
      load();
    } catch {
      toast.error(t("providers.toast.reloadFailed"));
    } finally {
      setReloading(false);
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
        <h2 className="text-2xl font-semibold">{t("providers.title")}</h2>
        <div className="flex gap-2">
          <Button onClick={openCreateProvider}>
            <Plus className="h-4 w-4 mr-2" /> {t("providers.addProvider")}
          </Button>
          <Button variant="outline" onClick={handleReload} disabled={reloading}>
            <RefreshCw className={`h-4 w-4 mr-2${reloading ? " animate-spin" : ""}`} /> {t("providers.applyConfig")}
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
                    {p.active ? t("common.active") : t("common.inactive")}
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
                  <AlertTitle>{t("providers.schemaErrors")}</AlertTitle>
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
                  {t("providers.tools")} <span className="text-foreground font-medium">{p.tools.length}</span>
                </span>
                {providerUsage[p.key] && (
                  <>
                    <span className="text-muted-foreground">
                      {t("providers.callsThisMonth")} <span className="text-foreground font-medium">{providerUsage[p.key].count}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {t("providers.cost")} <span className="text-foreground font-medium">{providerUsage[p.key].cost.toFixed(4)}</span>
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
                        <TableHead>{t("providers.profile")}</TableHead>
                        <TableHead>{t("users.status")}</TableHead>
                        <TableHead>{t("providers.urlOverride")}</TableHead>
                        <TableHead>{t("providers.config")}</TableHead>
                        <TableHead className="text-right">{t("providers.calls")}</TableHead>
                        <TableHead className="text-right">{t("providers.cost")}</TableHead>
                        <TableHead className="text-right">{t("providers.budget")}</TableHead>
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
                                {t("common.inactive")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {profile.url || "-"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {profile.headers &&
                              Object.keys(profile.headers).length > 0 &&
                              t("providers.headerCount", { count: Object.keys(profile.headers).length })}
                            {profile.env &&
                              Object.keys(profile.env).length > 0 &&
                              t("providers.envCount", { count: Object.keys(profile.env).length })}
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
                          <TableCell className="text-right text-sm">
                            {profile.monthlyBudget && profile.monthlyBudget > 0 ? (
                              <span className={
                                (profileStatsMap[p.key]?.[profile.key]?.cost ?? 0) >= profile.monthlyBudget
                                  ? "text-destructive font-medium"
                                  : ""
                              }>
                                {profile.monthlyBudget}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{t("common.unlimited")}</span>
                            )}
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
                    <Plus className="h-3 w-3 mr-1" /> {t("providers.addProfile")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {providers.length === 0 && (
          <p className="text-muted-foreground text-center py-8">
            {t("providers.empty")}
          </p>
        )}
      </div>

      {/* Provider Dialog */}
      <Dialog open={providerOpen} onOpenChange={setProviderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProviderKey ? t("providers.editProviderTitle") : t("providers.addProviderTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("providers.keyRequired")}</Label>
              <Input
                value={providerForm.key}
                onChange={(e) =>
                  setProviderForm({ ...providerForm, key: e.target.value })
                }
                placeholder={t("providers.keyPlaceholder")}
                disabled={!!editingProviderKey}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("providers.name")}</Label>
              <Input
                value={providerForm.name}
                onChange={(e) =>
                  setProviderForm({ ...providerForm, name: e.target.value })
                }
                placeholder={t("providers.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("providers.type")}</Label>
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
                  <SelectItem value="http">{t("providers.typeHttp")}</SelectItem>
                  <SelectItem value="sse">{t("providers.typeSse")}</SelectItem>
                  <SelectItem value="stdio">{t("providers.typeStdio")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(providerForm.type === "sse" ||
              providerForm.type === "http") && (
              <div className="space-y-2">
                <Label>{t("providers.baseUrl")}</Label>
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
                  <Label>{t("providers.command")}</Label>
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
                  <Label>{t("providers.argsLabel")}</Label>
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
              <Label>{t("providers.activeLabel")}</Label>
            </div>

            {/* Circuit Breaker */}
            <div className="border rounded-md p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={providerForm.cbEnabled}
                  onCheckedChange={(checked) =>
                    setProviderForm({ ...providerForm, cbEnabled: checked })
                  }
                />
                <Label className="font-medium">{t("providers.cb.enabled")}</Label>
              </div>
              {providerForm.cbEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("providers.cb.failureThreshold")}</Label>
                      <Input
                        type="number"
                        min="0"
                        value={providerForm.cbFailureThreshold}
                        onChange={(e) =>
                          setProviderForm({
                            ...providerForm,
                            cbFailureThreshold: parseInt(e.target.value, 10) || 0,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("providers.cb.cooldownSeconds")}</Label>
                      <Input
                        type="number"
                        min="1"
                        value={providerForm.cbCooldownSeconds}
                        onChange={(e) =>
                          setProviderForm({
                            ...providerForm,
                            cbCooldownSeconds: parseInt(e.target.value, 10) || 60,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("providers.cb.failureStatusCodes")}</Label>
                    <Input
                      value={providerForm.cbFailureStatusCodes}
                      onChange={(e) =>
                        setProviderForm({
                          ...providerForm,
                          cbFailureStatusCodes: e.target.value,
                        })
                      }
                      placeholder="429, 500, 502, 503"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("providers.cb.tripOnContent")}</Label>
                    <Textarea
                      value={providerForm.cbTripOnContent}
                      onChange={(e) =>
                        setProviderForm({
                          ...providerForm,
                          cbTripOnContent: e.target.value,
                        })
                      }
                      placeholder={t("providers.cb.tripOnContentPlaceholder")}
                      rows={3}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProviderOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleProviderSubmit}
              disabled={!isProviderFormValid}
            >
              {editingProviderKey ? t("common.save") : t("common.add")}
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
                ? t("providers.editProfileTitle")
                : t("providers.addProfileTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("providers.profileKey")}</Label>
              <Input
                value={profileForm.key}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, key: e.target.value })
                }
                placeholder={t("providers.profileKeyPlaceholder")}
                disabled={!!editingProfileContext?.profileKey}
              />
            </div>
            {editingProfileContext &&
              (editingProfileContext.providerType === "sse" ||
                editingProfileContext.providerType === "http") && (
                <>
                  <div className="space-y-2">
                    <Label>{t("providers.urlOverrideLabel")}</Label>
                    <Input
                      value={profileForm.url}
                      onChange={(e) =>
                        setProfileForm({
                          ...profileForm,
                          url: e.target.value,
                        })
                      }
                      placeholder={t("providers.urlOverridePlaceholder")}
                    />
                  </div>
                  <KeyValueEditor
                    label={t("providers.customHeaders")}
                    value={profileForm.headers}
                    onChange={(headers) =>
                      setProfileForm({ ...profileForm, headers })
                    }
                    keyPlaceholder={t("providers.headerNamePlaceholder")}
                    valuePlaceholder={t("providers.headerValuePlaceholder")}
                  />
                </>
              )}
            {editingProfileContext &&
              editingProfileContext.providerType === "stdio" && (
                <KeyValueEditor
                  label={t("providers.envVars")}
                  value={profileForm.env}
                  onChange={(env) =>
                    setProfileForm({ ...profileForm, env })
                  }
                  keyPlaceholder={t("providers.varNamePlaceholder")}
                  valuePlaceholder={t("providers.varValuePlaceholder")}
                />
              )}
            <div className="space-y-2">
              <Label>{t("providers.monthlyBudget")}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={profileForm.monthlyBudget || ""}
                onChange={(e) =>
                  setProfileForm({
                    ...profileForm,
                    monthlyBudget: parseFloat(e.target.value) || 0,
                  })
                }
                placeholder={t("providers.monthlyBudgetPlaceholder")}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={profileForm.active}
                onCheckedChange={(checked) =>
                  setProfileForm({ ...profileForm, active: checked })
                }
              />
              <Label>{t("providers.activeLabel")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleProfileSubmit}
              disabled={!isProfileFormValid}
            >
              {editingProfileContext?.profileKey ? t("common.save") : t("common.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
