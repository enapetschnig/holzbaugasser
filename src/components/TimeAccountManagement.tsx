import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Clock, Plus, History, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type TimeAccount = {
  id: string;
  user_id: string;
  balance_hours: number;
};

type Transaction = {
  id: string;
  user_id: string;
  changed_by: string;
  change_type: string;
  hours: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  created_at: string;
};

interface TimeAccountManagementProps {
  profiles: Profile[];
}

export default function TimeAccountManagement({ profiles }: TimeAccountManagementProps) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<TimeAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adjustHours, setAdjustHours] = useState("");
  const [adjustType, setAdjustType] = useState<"gutschrift" | "abzug">("gutschrift");
  const [adjustReason, setAdjustReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: accData }, { data: txData }] = await Promise.all([
      supabase.from("time_accounts").select("*"),
      supabase
        .from("time_account_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (accData) setAccounts(accData as TimeAccount[]);
    if (txData) setTransactions(txData as Transaction[]);
    setLoading(false);
  };

  // Auto-book overtime for last completed month
  const autoBookOvertime = async () => {
    const now = new Date();
    const lastMonth = now.getMonth(); // 0-based, so this is "last month" (current month index)
    const lastMonthYear = lastMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const lastMonthNum = lastMonth === 0 ? 12 : lastMonth;
    const monthNames = ["Jänner","Feber","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
    const monthLabel = `${monthNames[lastMonthNum - 1]} ${lastMonthYear}`;
    const bookingKey = `Monatsabschluss ${monthLabel}`;

    // Check if already booked
    const { data: existingBookings } = await supabase
      .from("time_account_transactions")
      .select("id")
      .eq("change_type", bookingKey)
      .limit(1);
    if (existingBookings && existingBookings.length > 0) return; // Already booked

    // Calculate hours for each employee for last month
    const startDate = `${lastMonthYear}-${String(lastMonthNum).padStart(2, "0")}-01`;
    const daysInMonth = new Date(lastMonthYear, lastMonthNum, 0).getDate();
    const endDate = `${lastMonthYear}-${String(lastMonthNum).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

    const { data: entries } = await supabase
      .from("time_entries")
      .select("user_id, stunden")
      .gte("datum", startDate)
      .lte("datum", endDate);

    if (!entries || entries.length === 0) return;

    // Load employee weekly hours for Soll calculation
    const { data: employees } = await supabase.from("employees").select("user_id, monats_soll_stunden");
    const weeklyMap: Record<string, number | null> = {};
    if (employees) employees.forEach((e: any) => { if (e.user_id) weeklyMap[e.user_id] = e.monats_soll_stunden; });

    // Calculate monthly target
    let monthlyTarget = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(lastMonthYear, lastMonthNum - 1, d).getDay();
      if (dow === 0 || dow === 6) continue;
      monthlyTarget += dow === 5 ? 7 : 8;
    }

    // Sum hours per user
    const hoursPerUser: Record<string, number> = {};
    for (const e of entries) {
      hoursPerUser[e.user_id] = (hoursPerUser[e.user_id] || 0) + (parseFloat(e.stunden as any) || 0);
    }

    const { data: { user } } = await supabase.auth.getUser();

    for (const [userId, totalHours] of Object.entries(hoursPerUser)) {
      const weekly = weeklyMap[userId];
      const soll = weekly != null ? Math.round((weekly / 39) * monthlyTarget * 10) / 10 : monthlyTarget;
      const diff = Math.round((totalHours - soll) * 100) / 100;
      if (diff === 0) continue;

      // Get or create time account
      let account = accounts.find(a => a.user_id === userId);
      if (!account) {
        const { data: newAcc } = await supabase.from("time_accounts").insert({ user_id: userId, balance_hours: 0 }).select("*").single();
        if (newAcc) account = newAcc as TimeAccount;
      }
      if (!account) continue;

      const balanceBefore = account.balance_hours || 0;
      const balanceAfter = Math.round((balanceBefore + diff) * 100) / 100;

      await supabase.from("time_account_transactions").insert({
        user_id: userId,
        changed_by: user?.id,
        change_type: bookingKey,
        hours: diff,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reason: `${monthLabel}: ${totalHours}h Ist - ${soll}h Soll = ${diff >= 0 ? "+" : ""}${diff}h`,
      });

      await supabase.from("time_accounts").update({ balance_hours: balanceAfter }).eq("id", account.id);
    }
  };

  useEffect(() => {
    fetchData().then(() => autoBookOvertime().then(() => fetchData()));
  }, []);

  const getProfileName = (userId: string) => {
    const p = profiles.find((p) => p.id === userId);
    return p ? `${p.vorname} ${p.nachname}` : "Unbekannt";
  };

  const ensureAccount = async (userId: string) => {
    const { error } = await supabase.from("time_accounts").insert({
      user_id: userId,
      balance_hours: 0,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    }
    fetchData();
  };

  const handleAdjust = async () => {
    if (!selectedUserId || !adjustHours || !adjustReason.trim()) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Bitte alle Felder ausfüllen",
      });
      return;
    }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      return;
    }

    const account = accounts.find((a) => a.user_id === selectedUserId);
    if (!account) {
      toast({ variant: "destructive", title: "Fehler", description: "Kein Zeitkonto gefunden" });
      setSubmitting(false);
      return;
    }

    const hours = parseFloat(adjustHours);
    const effectiveHours = adjustType === "abzug" ? -hours : hours;
    const balanceBefore = account.balance_hours;
    const balanceAfter = balanceBefore + effectiveHours;

    // Update balance
    const { error: updateErr } = await supabase
      .from("time_accounts")
      .update({ balance_hours: balanceAfter })
      .eq("id", account.id);

    if (updateErr) {
      toast({ variant: "destructive", title: "Fehler", description: updateErr.message });
      setSubmitting(false);
      return;
    }

    // Insert transaction (audit log)
    const { error: txErr } = await supabase.from("time_account_transactions").insert({
      user_id: selectedUserId,
      changed_by: user.id,
      change_type: adjustType === "gutschrift" ? "Gutschrift" : adjustType === "abzug" ? "Abzug" : "ZA",
      hours: effectiveHours,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reason: adjustReason.trim(),
    });

    if (txErr) {
      console.error("Transaction log error:", txErr);
    }

    toast({
      title: "Zeitkonto aktualisiert",
      description: `${getProfileName(selectedUserId)}: ${effectiveHours > 0 ? "+" : ""}${effectiveHours.toFixed(2)} h`,
    });

    setShowAdjustDialog(false);
    setAdjustHours("");
    setAdjustReason("");
    setSubmitting(false);
    fetchData();
  };

  const userTransactions = selectedUserId
    ? transactions.filter((t) => t.user_id === selectedUserId)
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time Accounts Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Zeitkonten
          </CardTitle>
          <CardDescription>
            Überstunden und Zeitausgleich (ZA) pro Mitarbeiter
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {profiles
              .filter((p) => p.vorname && p.nachname)
              .map((profile) => {
                const account = accounts.find((a) => a.user_id === profile.id);

                return (
                  <div
                    key={profile.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border"
                  >
                    <div>
                      <p className="font-medium">
                        {profile.vorname} {profile.nachname}
                      </p>
                      {account ? (
                        <p className="text-sm">
                          Saldo:{" "}
                          <span
                            className={
                              account.balance_hours >= 0
                                ? "text-green-600 font-semibold"
                                : "text-destructive font-semibold"
                            }
                          >
                            {account.balance_hours >= 0 ? "+" : ""}
                            {Number(account.balance_hours).toFixed(2)} h
                          </span>
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Noch kein Zeitkonto
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {account ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedUserId(profile.id);
                              setShowAdjustDialog(true);
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Buchen
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedUserId(profile.id);
                              setShowHistoryDialog(true);
                            }}
                          >
                            <History className="h-3 w-3 mr-1" /> Verlauf
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => ensureAccount(profile.id)}
                        >
                          Zeitkonto anlegen
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      {/* Adjust Dialog */}
      <Dialog open={showAdjustDialog} onOpenChange={setShowAdjustDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Zeitkonto buchen</DialogTitle>
            <DialogDescription>
              {selectedUserId && getProfileName(selectedUserId)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Art</Label>
              <Select
                value={adjustType}
                onValueChange={(v) => setAdjustType(v as "gutschrift" | "abzug")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gutschrift">Gutschrift (Überstunden)</SelectItem>
                  <SelectItem value="abzug">Abzug (Zeitausgleich / ZA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Stunden</Label>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                value={adjustHours}
                onChange={(e) => setAdjustHours(e.target.value)}
                placeholder="z.B. 8"
              />
            </div>
            <div className="space-y-2">
              <Label>Grund (Pflichtfeld)</Label>
              <Textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="z.B. Überstunden KW12, ZA-Tag 15.03...."
                rows={2}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAdjustDialog(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleAdjust} disabled={submitting}>
                {submitting ? "Wird gebucht..." : "Buchen"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              Verlauf – {selectedUserId && getProfileName(selectedUserId)}
            </DialogTitle>
            <DialogDescription>
              Alle Buchungen und Änderungen am Zeitkonto
            </DialogDescription>
          </DialogHeader>
          {userTransactions.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Noch keine Buchungen
            </p>
          ) : (
            <div className="space-y-2">
              {userTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-lg border text-sm space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={tx.hours >= 0 ? "default" : "destructive"}
                    >
                      {tx.hours >= 0 ? "+" : ""}
                      {Number(tx.hours).toFixed(2)} h · {tx.change_type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(tx.created_at), "dd.MM.yyyy HH:mm", {
                        locale: de,
                      })}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {tx.reason || "Kein Grund angegeben"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Saldo: {Number(tx.balance_before).toFixed(2)} → {Number(tx.balance_after).toFixed(2)} h · geändert von{" "}
                    {getProfileName(tx.changed_by)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
