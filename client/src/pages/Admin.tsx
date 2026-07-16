import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Shield, Users, CreditCard, TrendingUp, Ban, Gift, LogOut, Activity } from "lucide-react";

export default function Admin() {
  const [password, setPassword] = useState("");

  const verifyQuery = trpc.admin.verify.useQuery(undefined, { retry: false });
  const loginMutation = trpc.admin.login.useMutation({
    onSuccess: () => {
      toast.success("Admin access granted");
      verifyQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const logoutMutation = trpc.admin.logout.useMutation({
    onSuccess: () => {
      toast.success("Logged out");
      verifyQuery.refetch();
    },
  });

  if (verifyQuery.isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
      </div>
    );
  }

  if (!verifyQuery.data?.authenticated) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <h1 className="text-2xl font-bold text-white">Admin Access</h1>
            <p className="text-white/50 text-sm mt-1">Enter admin password to continue</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
            <Input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-white/5 border-white/10 text-white h-11"
              onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate({ password })}
            />
            <Button
              className="w-full bg-red-500 hover:bg-red-600 text-white"
              onClick={() => loginMutation.mutate({ password })}
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Login"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <AdminDashboard onLogout={() => logoutMutation.mutate()} />;
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const statsQuery = trpc.admin.stats.useQuery();
  const usersQuery = trpc.admin.users.useQuery();
  const subsQuery = trpc.admin.subscriptions.useQuery();
  const activityQuery = trpc.admin.userActivity.useQuery();
  const [grantModal, setGrantModal] = useState<{ sessionToken: string; mobile: string } | null>(null);
  const [grantPlan, setGrantPlan] = useState<"trial" | "monthly" | "quarterly" | "half_yearly" | "yearly">("monthly");
  const [grantDays, setGrantDays] = useState("");

  const grantMutation = trpc.admin.grantAccess.useMutation({
    onSuccess: () => {
      toast.success("Access granted");
      subsQuery.refetch();
      setGrantModal(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = trpc.admin.revokeAccess.useMutation({
    onSuccess: () => {
      toast.success("Access revoked");
      subsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-red-400" />
          <h1 className="text-xl font-bold">ScalpBot Admin</h1>
        </div>
        <Button variant="outline" size="sm" onClick={onLogout} className="border-white/20 text-white/60 hover:text-white">
          <LogOut className="w-4 h-4 mr-2" /> Logout
        </Button>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard icon={<Users className="w-5 h-5" />} label="Total Users" value={stats?.totalUsers ?? 0} color="teal" />
          <StatCard icon={<CreditCard className="w-5 h-5" />} label="Active Paid" value={stats?.activeSubscriptions ?? 0} color="green" />
          <StatCard icon={<Gift className="w-5 h-5" />} label="Trial Users" value={stats?.trialUsers ?? 0} color="amber" />
          <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Total Revenue" value={`₹${(stats?.totalRevenue ?? 0).toLocaleString()}`} color="purple" />
        </div>

        {/* Users Table */}
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

        {/* Subscriptions Table */}
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
      </div>

      {/* Grant Modal */}
      {/* User Activity Table */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
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

      {grantModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-semibold">Grant Access</h3>
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
