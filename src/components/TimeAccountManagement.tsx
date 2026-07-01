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

  // Live sync: Calculate overtime from all completed months and update balance
  const syncOvertimeBalances = async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-based

    // Load all time entries for this year (including current month = live)
    const startDate = `${currentYear}-01-01`;
    const endDate = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${new Date(currentYear, currentMonth, 0).getDate()}`;

    const { data: entries } = await supabase
      .from("time_entries")
      .select("user_id, datum, stunden, taetigkeit")
      .gte("datum", startDate)
      .lte("datum", endDate);

    if (!entries) return;

    // Load employee weekly hours + Eintritt/Austritt (für anteiliges Soll bei
    // Teil-Monaten — sonst bekäme ein Mitte-des-Monats-Starter ein Riesen-Minus).
    const { data: employees } = await supabase
      .from("employees")
      .select("user_id, monats_soll_stunden, eintritt_datum, austritt_datum");
    const weeklyMap: Record<string, number | null> = {};
    const eintrittMap: Record<string, string | null> = {};
    const austrittMap: Record<string, string | null> = {};
    if (employees) employees.forEach((e: any) => {
      if (e.user_id) {
        weeklyMap[e.user_id] = e.monats_soll_stunden;
        eintrittMap[e.user_id] = e.eintritt_datum || null;
        austrittMap[e.user_id] = e.austritt_datum || null;
      }
    });
    // Load user roles for correct daily-soll pattern
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    const roleMap: Record<string, string> = {};
    // Höchste Rolle gewinnt (PL/Admin → 40h-Basis, 8h/Tag). Verhindert, dass eine
    // Zweitrolle (z.B. "vorarbeiter") einen Admin fälschlich auf 39h-Basis zieht.
    const rolePrio = (r: string) =>
      r === "administrator" || r === "projektleiter" ? 2 : 1;
    if (roles) roles.forEach((r: any) => {
      const cur = roleMap[r.user_id];
      if (!cur || rolePrio(r.role) > rolePrio(cur)) roleMap[r.user_id] = r.role;
    });

    const monthNames = ["Jänner","Feber","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

    const { data: { user: currentUser } } = await supabase.auth.getUser();

    // Echtes Gleitzeitkonto (Plus UND Minus) wird erst ab diesem Monat gebucht.
    // Grund: davor war die App im Ramp-up, die Zeiterfassung unvollständig — ein
    // rückwirkendes Minus wäre kein echtes Minus, sondern nur eine Erfassungslücke.
    // Plus wird immer gebucht (Mehrstunden sind unabhängig von Lücken echt).
    const MINUS_START = "2026-07"; // YYYY-MM — ab hier zählt auch Minus

    // Voll-Tages-Absenzen: füllen den ganzen Tag und werden mit dem (ggf. Teilzeit-
    // anteiligen) Tages-Soll gewertet, damit sie exakt das Soll decken (netto 0).
    // Teil-Absenzen (Arzt/ZA/Sonstiges) zählen mit ihren echten Stunden.
    const FULL_ABSENCE = new Set([
      "Urlaub", "Krankenstand", "Feiertag", "Schule", "Berufsschule",
      "Fortbildung", "Weiterbildung",
    ]);

    // Eine Monats-Buchung idempotent auf ihren Soll-Wert bringen — oder entfernen.
    // target === null  → es darf KEINE Buchung geben (evtl. alte wird gelöscht).
    // Verhindert stehengebliebene "Überstunden {Monat}"-Buchungen (z.B. laufender
    // Monat war kurz im Plus und fällt wieder ins Minus, oder Beschäftigung endet).
    const reconcile = async (
      userId: string, txKey: string, target: number | null, reason?: string
    ) => {
      const { data: existingTx } = await supabase
        .from("time_account_transactions")
        .select("id, hours")
        .eq("user_id", userId)
        .eq("change_type", txKey)
        .maybeSingle();

      if (target === null) {
        if (existingTx) {
          await supabase.from("time_account_transactions").delete().eq("id", existingTx.id);
        }
        return;
      }
      if (!existingTx) {
        await supabase.from("time_account_transactions").insert({
          user_id: userId, changed_by: currentUser?.id, change_type: txKey,
          hours: target, balance_before: 0, balance_after: 0, reason,
        });
      } else if (Math.abs((parseFloat(existingTx.hours as any) || 0) - target) > 0.01) {
        await supabase.from("time_account_transactions")
          .update({ hours: target, reason }).eq("id", existingTx.id);
      }
    };

    for (let m = 1; m <= currentMonth; m++) {
      const monthKey = `${currentYear}-${String(m).padStart(2, "0")}`;
      const daysInMonth = new Date(currentYear, m, 0).getDate();
      const monthStart = `${monthKey}-01`;
      const monthEnd = `${monthKey}-${String(daysInMonth).padStart(2, "0")}`;
      const monthLabel = `${monthNames[m - 1]} ${currentYear}`;
      const txKey = `Überstunden ${monthLabel}`;
      const isCurrentMonth = m === currentMonth;                 // noch nicht abgeschlossen
      const minusAllowed = monthKey >= MINUS_START && !isCurrentMonth;

      const monthEntries = entries.filter(e => e.datum >= monthStart && e.datum <= monthEnd);

      // Pro User: gearbeitete + Teil-Absenz-Stunden getrennt von Voll-Absenz-Stunden.
      // Einträge außerhalb der Beschäftigung (Eintritt/Austritt) werden ignoriert —
      // konsistent mit dem Soll-Fenster unten (sonst Phantom-Plus/Minus).
      const workedPerUser: Record<string, number> = {};
      const fullAbsPerUser: Record<string, number> = {};
      for (const e of monthEntries) {
        const uid = e.user_id;
        const eintritt = eintrittMap[uid];
        const austritt = austrittMap[uid];
        if (eintritt && e.datum < eintritt) continue;
        if (austritt && e.datum > austritt) continue;
        const h = parseFloat(e.stunden as any) || 0;
        if (FULL_ABSENCE.has(e.taetigkeit)) fullAbsPerUser[uid] = (fullAbsPerUser[uid] || 0) + h;
        else workedPerUser[uid] = (workedPerUser[uid] || 0) + h;
      }

      const userIds = new Set([...Object.keys(workedPerUser), ...Object.keys(fullAbsPerUser)]);
      for (const userId of userIds) {
        const weekly = weeklyMap[userId];
        const role = roleMap[userId];
        const isPL = role === "projektleiter" || role === "administrator";
        const baseWeekly = isPL ? 40 : 39;
        const eintritt = eintrittMap[userId]; // "YYYY-MM-DD" oder null
        const austritt = austrittMap[userId];

        // Monats-Soll pro Mitarbeiter: nur Arbeitstage INNERHALB der Beschäftigung.
        // (Eintritt=null → ganzer Monat; Austritt=null → kein Ende.)
        let sollBase = 0;
        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${monthKey}-${String(d).padStart(2, "0")}`;
          const dow = new Date(currentYear, m - 1, d).getDay();
          if (dow === 0 || dow === 6) continue;              // Wochenende
          if (eintritt && dateStr < eintritt) continue;      // vor Eintritt
          if (austritt && dateStr > austritt) continue;      // nach Austritt
          sollBase += isPL ? 8 : (dow === 5 ? 7 : 8);
        }
        // Nicht (mehr/noch) beschäftigt in diesem Monat → evtl. alte Buchung entfernen.
        if (sollBase === 0) { await reconcile(userId, txKey, null); continue; }

        // Teilzeit-Faktor: skaliert Soll UND Voll-Absenzen gleich, sodass ein
        // Feiertag/Urlaubstag exakt das Tages-Soll deckt (netto 0, kein Phantom-Plus).
        const factor = weekly != null ? weekly / baseWeekly : 1;
        const soll = Math.round(factor * sollBase * 10) / 10;
        const ist = Math.round(
          ((workedPerUser[userId] || 0) + (fullAbsPerUser[userId] || 0) * factor) * 100
        ) / 100;
        const diff = Math.round((ist - soll) * 100) / 100;

        // Buchungsregel:
        // - Plus (diff > 0): immer buchen — Mehrstunden sind echt.
        // - Minus (diff <= 0): nur für abgeschlossene Monate ab MINUS_START.
        //   Historie (Ramp-up) + laufender, unvollständiger Monat → kein Minus.
        const target = diff > 0 ? diff : (minusAllowed ? diff : null);

        const vorz = (target ?? 0) >= 0 ? "+" : "";
        const reason = `${monthLabel}: ${ist}h gearbeitet - ${soll}h Soll = ${vorz}${target ?? 0}h`;
        await reconcile(userId, txKey, target, reason);
      }
    }

    // Load fresh accounts and ALL transactions to compute real balance
    const { data: freshAccounts } = await supabase.from("time_accounts").select("*");
    if (!freshAccounts) return;

    // For each account, compute balance = sum of all transactions
    const { data: allTx } = await supabase.from("time_account_transactions").select("user_id, hours");
    const txSumPerUser: Record<string, number> = {};
    if (allTx) {
      for (const tx of allTx) {
        txSumPerUser[tx.user_id] = (txSumPerUser[tx.user_id] || 0) + (parseFloat(tx.hours as any) || 0);
      }
    }

    for (const acc of freshAccounts as TimeAccount[]) {
      const realBalance = Math.round((txSumPerUser[acc.user_id] || 0) * 100) / 100;
      if (Math.abs((acc.balance_hours || 0) - realBalance) > 0.01) {
        await supabase.from("time_accounts").update({ balance_hours: realBalance }).eq("id", acc.id);
      }
    }
  };

  useEffect(() => {
    fetchData().then(() => syncOvertimeBalances().then(() => fetchData()));
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
