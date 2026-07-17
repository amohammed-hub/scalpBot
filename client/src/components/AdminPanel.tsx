import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Shield, Users, CreditCard, TrendingUp, Ban, Gift, Activity, ArrowLeft, UserPlus, Clock, RotateCcw } from "lucide-react";

type AdminTab = "users" | "subscriptions" | "activity" | "grants";

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const statsQuery = trpc.admin.stats.useQuery();
  const usersQuery = trpc.admin.users.useQuery();
  const subsQuery = trpc.admin.subscriptions.useQuery();
  const activityQuery = trpc.admin.userActivity.useQuery();
  const grantsQuery = trpc.admin.listGrants.useQuery();

  const [grantModal, setGrantModal] = useState<{ sessionToken: string; mobile: string } | null>(null);
  const [grantPlan, setGrantPlan] = useState<"trial" | "monthly" | "quarterly" | "half_yearly" | "yearly">("monthly");
  const [grantDays, setGrantDays] = useState("");

  const grantMutation = trpc.admin.grantAccess.useMutation({
    onSuccess: () => {
      toast.success("Access granted");
      subsQuery.refetch();
      usersQuery.refetch();
      setGrantModal(null);
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const revokeMutation = trpc.admin.revokeAccess.useMutation({
    onSuccess: () => {
      toast.success("Access revoked");
      subsQuery.refetch();
      usersQuery.refetch();
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  // ── Manual Grant state ────────────────────────────────────────────────────
  const [mgUserIdentifier, setMgUserIdentifier] = useState("");
  const [mgUserName, setMgUserName] = useState("");
  const [mgPlan, setMgPlan] = useState<"monthly" | "quarterly" | "half_yearly" | "yearly" | "custom">("monthly");
  const [mgDuration, setMgDuration] = useState(30);
  const [mgStartDate, setMgStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [mgNote, setMgNote] = useState("");

  const manualGrantMutation = trpc.admin.manualGrant.useMutation({
    onSuccess: (data) => {
      toast.success(`Access granted! Expires: ${new Date(data.expiresAt).toLocaleDateString()}`);
      grantsQuery.refetch();
      subsQuery.refetch();
      setMgUserIdentifier("");
      setMgUserName("");
      setMgNote("");
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const revokeGrantMutation = trpc.admin.revokeGrant.useMutation({
    onSuccess: () => { toast.success("Grant revoked"); grantsQuery.refetch(); subsQuery.refetch(); },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const [extendId, setExtendId] = useState<number | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const extendGrantMutation = trpc.admin.extendGrant.useMutation({
    onSuccess: (data) => { toast.success(`Extended! New expiry: ${new Date(data.newExpiresAt).toLocaleDateString()}`); grantsQuery.refetch(); setExtendId(null); },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const stats = statsQuery.data;

  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: "users", label: "Users", icon: <Users className="w-4 h-4" /> },
    { id: "subscriptions", label: "Subscriptions", icon: <CreditCard className="w-4 h-4" /> },
    { id: "activity", label: "Activity", icon: <Activity className="w-4 h-4" /> },
    { id: "grants", label: "Access Grants", icon: <UserPlus className="w-4 h-4" /> },
  ];

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 text-white/60 hover:text-white transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Shield className="w-6 h-6 text-red-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
            <p className="text-white/50 text-sm">Manage users, subscriptions & activity</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Total Users" value={stats?.totalUsers ?? 0} color="teal" />
        <StatCard icon={<CreditCard className="w-5 h-5" />} label="Active Paid" value={stats?.activeSubscriptions ?? 0} color="green" />
        <StatCard icon={<Gift className="w-5 h-5" />} label="Trial Users" value={stats?.trialUsers ?? 0} color="amber" />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Total Revenue" value={`₹${(stats?.totalRevenue ?? 0).toLocaleString()}`} color="purple" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 p-1 rounded-xl border border-white/10 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "users" && (
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="w-5 h-5 text-teal-400" /> Users ({usersQuery.data?.length ?? 0})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Mobile</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Name</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Role</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Joined</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Last Login</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {usersQuery.data?.map((user: any) => (
                  <tr key={user.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 font-mono text-teal-300">{user.mobile}</td>
                    <td className="px-4 py-3">{user.name || <span className="text-white/30">—</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${user.role === "admin" ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/60"}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/50">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 text-white/50">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}</td>
                    <td className="px-4 py-3 space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-teal-500/30 text-teal-300 hover:bg-teal-500/10"
                        onClick={() => setGrantModal({ sessionToken: user.sessionToken ?? "", mobile: user.mobile })}
                      >
                        <Gift className="w-3 h-3 mr-1" /> Grant
                      </Button>
                      {user.sessionToken && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-red-500/30 text-red-300 hover:bg-red-500/10"
                          onClick={() => {
                            if (confirm(`Revoke ALL access for ${user.mobile}?`)) {
                              revokeMutation.mutate({ sessionToken: user.sessionToken! });
                            }
                          }}
                        >
                          <Ban className="w-3 h-3 mr-1" /> Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!usersQuery.data || usersQuery.data.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-white/30">No users yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "subscriptions" && (
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-green-400" /> Subscriptions ({subsQuery.data?.length ?? 0})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Session</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Plan</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Starts</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Expires</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Razorpay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {subsQuery.data?.map((sub: any) => {
                  const isActive = sub.status === "active" && new Date(sub.expiresAt) > new Date();
                  return (
                    <tr key={sub.id} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-mono text-xs text-white/50">{sub.sessionToken?.slice(0, 8)}...</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          sub.plan === "trial" ? "bg-amber-500/20 text-amber-300" :
                          sub.plan === "yearly" ? "bg-purple-500/20 text-purple-300" :
                          "bg-teal-500/20 text-teal-300"
                        }`}>
                          {sub.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${isActive ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>
                          {isActive ? "Active" : sub.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/70">₹{((sub.amountPaid ?? 0) / 100).toLocaleString()}</td>
                      <td className="px-4 py-3 text-white/50">{sub.startsAt ? new Date(sub.startsAt).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3 text-white/50">{sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-white/40">{sub.razorpayPaymentId || "—"}</td>
                    </tr>
                  );
                })}
                {(!subsQuery.data || subsQuery.data.length === 0) && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-white/30">No subscriptions yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "activity" && (
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400" /> User Activity ({activityQuery.data?.length ?? 0})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Session</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Bots</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Running</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Total Trades</th>
                  <th className="text-left px-4 py-3 text-white/50 font-medium">Today P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {activityQuery.data?.map((ua: any) => {
                  const runningBots = ua.bots.filter((b: any) => b.status === "running");
                  const totalDailyPnl = ua.bots.reduce((sum: number, b: any) => sum + (b.dailyPnl ?? 0), 0);
                  return (
                    <tr key={ua.sessionToken} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-mono text-xs text-white/50">{ua.sessionToken.slice(0, 8)}...</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {ua.bots.map((b: any, i: number) => (
                            <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] ${b.status === "running" ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/40"}`}>
                              {b.symbol} ({b.mode})
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${runningBots.length > 0 ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/40"}`}>
                          {runningBots.length}/{ua.bots.length}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/70">{ua.totalTrades}</td>
                      <td className={`px-4 py-3 font-medium ${totalDailyPnl > 0 ? "text-green-400" : totalDailyPnl < 0 ? "text-red-400" : "text-white/40"}`}>
                        {totalDailyPnl > 0 ? "+" : ""}₹{totalDailyPnl.toFixed(0)}
                      </td>
                    </tr>
                  );
                })}
                {(!activityQuery.data || activityQuery.data.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-white/30">No bot activity yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grant Modal */}
      {activeTab === "grants" && (
        <div className="space-y-6">
          {/* Grant Access Form */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <UserPlus className="w-5 h-5 text-teal-400" /> Grant Access
            </h2>
            <p className="text-sm text-white/50 mb-4">Grant free platform access to beta testers, friends, or partners — no payment required.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-white/50 mb-1 block">User Email or Phone *</label>
                <Input
                  placeholder="+919876543210 or user@email.com"
                  value={mgUserIdentifier}
                  onChange={e => setMgUserIdentifier(e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Name (optional)</label>
                <Input
                  placeholder="User's name for reference"
                  value={mgUserName}
                  onChange={e => setMgUserName(e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Plan</label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                  value={mgPlan}
                  onChange={e => {
                    const plan = e.target.value as typeof mgPlan;
                    setMgPlan(plan);
                    const daysMap: Record<string, number> = { monthly: 30, quarterly: 90, half_yearly: 180, yearly: 365, custom: 30 };
                    setMgDuration(daysMap[plan] ?? 30);
                  }}
                >
                  <option value="monthly">Monthly (30 days)</option>
                  <option value="quarterly">3 Months (90 days)</option>
                  <option value="half_yearly">6 Months (180 days)</option>
                  <option value="yearly">1 Year (365 days)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Duration (days)</label>
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={mgDuration}
                  onChange={e => setMgDuration(Number(e.target.value))}
                  disabled={mgPlan !== "custom"}
                  className="bg-white/5 border-white/10 text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Start Date</label>
                <Input
                  type="date"
                  value={mgStartDate}
                  onChange={e => setMgStartDate(e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Note / Reason (optional)</label>
                <Input
                  placeholder="e.g. Beta tester, friend, partner deal"
                  value={mgNote}
                  onChange={e => setMgNote(e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
            </div>
            <Button
              className="mt-4 bg-teal-500 hover:bg-teal-600 text-white"
              disabled={!mgUserIdentifier.trim() || manualGrantMutation.isPending}
              onClick={() => {
                manualGrantMutation.mutate({
                  userIdentifier: mgUserIdentifier.trim(),
                  userName: mgUserName.trim() || undefined,
                  plan: mgPlan,
                  durationDays: mgDuration,
                  startsAt: mgStartDate,
                  note: mgNote.trim() || undefined,
                });
              }}
            >
              {manualGrantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
              Grant Access
            </Button>
          </div>

          {/* Active Grants Table */}
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-400" /> Active Grants ({grantsQuery.data?.length ?? 0})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr>
                    <th className="text-left px-4 py-3 text-white/50 font-medium">User</th>
                    <th className="text-left px-4 py-3 text-white/50 font-medium">Plan</th>
                    <th className="text-left px-4 py-3 text-white/50 font-medium">Granted On</th>
                    <th className="text-left px-4 py-3 text-white/50 font-medium">Expires</th>
                    <th className="text-left px-4 py-3 text-white/50 font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-white/50 font-medium">Note</th>
                    <th className="text-left px-4 py-3 text-white/50 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {grantsQuery.data?.map((grant: any) => {
                    const isExpired = grant.status === "expired" || new Date(grant.expiresAt) < new Date();
                    const isRevoked = grant.status === "revoked";
                    const daysLeft = Math.max(0, Math.ceil((new Date(grant.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                    return (
                      <tr key={grant.id} className="hover:bg-white/5">
                        <td className="px-4 py-3">
                          <div className="text-teal-300 font-mono text-xs">{grant.userMobile || grant.userEmail || "—"}</div>
                          {grant.userName && <div className="text-white/40 text-xs">{grant.userName}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-300">
                            {grant.plan === "custom" ? `Custom (${grant.durationDays}d)` : grant.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/50">{new Date(grant.startsAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-white/50">
                          {new Date(grant.expiresAt).toLocaleDateString()}
                          {!isExpired && !isRevoked && <span className="text-[10px] text-amber-300 ml-1">({daysLeft}d left)</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            isRevoked ? "bg-red-500/20 text-red-300" :
                            isExpired ? "bg-white/10 text-white/40" :
                            "bg-green-500/20 text-green-300"
                          }`}>
                            {isRevoked ? "Revoked" : isExpired ? "Expired" : "Active"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/40 text-xs max-w-[150px] truncate">{grant.note || "—"}</td>
                        <td className="px-4 py-3 space-x-1">
                          {!isRevoked && !isExpired && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] border-red-500/30 text-red-300 hover:bg-red-500/10"
                              onClick={() => { if (confirm("Revoke this grant?")) revokeGrantMutation.mutate({ grantId: grant.id }); }}
                              disabled={revokeGrantMutation.isPending}
                            >
                              <Ban className="w-3 h-3 mr-0.5" /> Revoke
                            </Button>
                          )}
                          {!isRevoked && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] border-teal-500/30 text-teal-300 hover:bg-teal-500/10"
                              onClick={() => setExtendId(grant.id)}
                            >
                              <RotateCcw className="w-3 h-3 mr-0.5" /> Extend
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(!grantsQuery.data || grantsQuery.data.length === 0) && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-white/30">No grants yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Extend Grant Modal */}
      {extendId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-semibold text-white">Extend Grant</h3>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Additional Days</label>
              <Input
                type="number"
                min={1}
                max={3650}
                value={extendDays}
                onChange={e => setExtendDays(Number(e.target.value))}
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-teal-500 hover:bg-teal-600 text-white"
                onClick={() => extendGrantMutation.mutate({ grantId: extendId, additionalDays: extendDays })}
                disabled={extendGrantMutation.isPending}
              >
                {extendGrantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Extend"}
              </Button>
              <Button variant="outline" className="border-white/20 text-white/60" onClick={() => setExtendId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {grantModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-semibold text-white">Grant Access</h3>
            <p className="text-sm text-white/50">User: <span className="text-teal-300">{grantModal.mobile}</span></p>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Plan</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-sm"
                value={grantPlan}
                onChange={(e) => setGrantPlan(e.target.value as any)}
              >
                <option value="trial">Trial (2 days)</option>
                <option value="monthly">Monthly (30 days)</option>
                <option value="quarterly">Quarterly (90 days)</option>
                <option value="half_yearly">Half Yearly (180 days)</option>
                <option value="yearly">Yearly (365 days)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Custom days (optional)</label>
              <Input
                type="number"
                placeholder="Leave empty for default"
                value={grantDays}
                onChange={(e) => setGrantDays(e.target.value)}
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-teal-500 hover:bg-teal-600 text-white"
                onClick={() => {
                  grantMutation.mutate({
                    sessionToken: grantModal.sessionToken,
                    plan: grantPlan,
                    days: grantDays ? parseInt(grantDays) : undefined,
                  });
                }}
                disabled={grantMutation.isPending}
              >
                {grantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Grant"}
              </Button>
              <Button variant="outline" className="border-white/20 text-white/60" onClick={() => setGrantModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    teal: "bg-teal-500/10 text-teal-400 border-teal-500/20",
    green: "bg-green-500/10 text-green-400 border-green-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  };
  return (
    <div className={`rounded-xl border p-5 ${colorMap[color] ?? colorMap.teal}`}>
      <div className="flex items-center gap-2 mb-2 opacity-70">{icon}<span className="text-xs font-medium">{label}</span></div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}
