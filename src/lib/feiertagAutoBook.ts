// Automatisches Einbuchen österreichischer Feiertage in time_entries.
//
// Wird beim Login eines Admins / Projektleiters / Vorarbeiters aufgerufen
// (diese haben RLS-Rechte für fremde user_ids). Throttle siehe App.tsx.
//
// Stunden-Logik pro Tag:
//   - Wenn User einen Büro-Wochenplan hat (Barbara/Isabel): schedule.stunden
//     (Mo=7,5h, Di=4,5h etc. für Barbara — kein 8h-Pauschale)
//   - Sonst: Fr = 7h, Mo-Do = 8h
//
// Idempotent: prüft (user_id, datum, taetigkeit="Feiertag") vor jedem INSERT.
// Skippt User, die am Feiertag bereits eine andere Absenz haben (z.B. Krankenstand).

import { supabase } from "@/integrations/supabase/client";
import { getAustrianFeiertage, type Feiertag } from "./feiertage";
import { getBuroSchedule, getSchedulePauseMinutes, hasBuroSchedule } from "./buroSchedules";
import { ABSENCE_TAETIGKEITEN } from "./absenceTypes";

export async function autoBookFeiertage(
  currentUserRole: string
): Promise<{ added: number }> {
  // Nur Admin/PL/Vorarbeiter dürfen für fremde User schreiben (RLS).
  if (!["administrator", "projektleiter", "vorarbeiter"].includes(currentUserRole)) {
    return { added: 0 };
  }

  // Zielmenge der User: aktive, nicht-hidden, nicht-extern
  const [profilesRes, rolesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id")
      .eq("is_active", true)
      .neq("is_hidden", true),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  const profiles = (profilesRes.data || []) as { id: string }[];
  const roles = (rolesRes.data || []) as { user_id: string; role: string }[];
  if (profiles.length === 0) return { added: 0 };
  const externIds = new Set(
    roles.filter((r) => r.role === "extern").map((r) => r.user_id)
  );
  const userIds = profiles.map((p) => p.id).filter((id) => !externIds.has(id));
  if (userIds.length === 0) return { added: 0 };

  // Relevante Feiertage: Jahresanfang bis +60 Tage. Vergangene werden
  // rückwirkend eingebucht (idempotent durch existing-Check), zukünftige
  // bis 2 Monate voraus.
  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01`;
  const limitDate = new Date(now);
  limitDate.setDate(limitDate.getDate() + 60);
  const limitStr = limitDate.toISOString().slice(0, 10);

  const years = new Set([now.getFullYear()]);
  if (now.getMonth() >= 10) years.add(now.getFullYear() + 1); // ab November Jahr+1 mit
  const allFeiertage: Feiertag[] = [];
  for (const y of years) allFeiertage.push(...getAustrianFeiertage(y));
  const relevant = allFeiertage.filter(
    (f) => f.datum >= yearStart && f.datum <= limitStr
  );
  if (relevant.length === 0) return { added: 0 };

  // Vorhandene Einträge laden — sowohl Feiertag selbst (Idempotenz) als auch
  // andere Absenzen am Tag (Krankenstand etc., diese verhindern Feiertag-Insert).
  const datums = relevant.map((f) => f.datum);
  const { data: existing } = await supabase
    .from("time_entries")
    .select("user_id, datum, taetigkeit")
    .in("datum", datums)
    .in("user_id", userIds);

  const feiertagSeen = new Set<string>();
  const otherAbsenceSeen = new Set<string>();
  for (const e of (existing || []) as any[]) {
    const key = `${e.user_id}|${e.datum}`;
    if (e.taetigkeit === "Feiertag") {
      feiertagSeen.add(key);
    } else if (ABSENCE_TAETIGKEITEN.includes(e.taetigkeit)) {
      otherAbsenceSeen.add(key);
    }
  }

  // Inserts vorbereiten
  const rows: any[] = [];
  for (const f of relevant) {
    const dow = new Date(f.datum + "T00:00:00").getDay();
    const isFr = dow === 5;
    for (const uid of userIds) {
      const key = `${uid}|${f.datum}`;
      if (feiertagSeen.has(key)) continue;       // schon da
      if (otherAbsenceSeen.has(key)) continue;   // andere Absenz hat Vorrang

      const sched = getBuroSchedule(uid, f.datum);
      // Fixer Wochenplan, aber an diesem Tag kein Arbeitstag (z.B. Malle Di/Mi)
      // → keinen Feiertag buchen (er hätte an dem Tag ohnehin nicht gearbeitet).
      if (!sched && hasBuroSchedule(uid)) continue;
      const stunden = sched ? sched.stunden : isFr ? 7 : 8;
      const startTime = sched ? sched.start : "07:00";
      const endTime = sched ? sched.end : isFr ? "14:00" : "15:00";
      const pauseMin = sched ? getSchedulePauseMinutes(sched) : 0;

      rows.push({
        user_id: uid,
        datum: f.datum,
        taetigkeit: "Feiertag",
        stunden,
        start_time: startTime,
        end_time: endTime,
        pause_minutes: pauseMin,
        project_id: null,
        location_type: null,
        entry_typ: "leistungsbericht", // Default — analog zu anderen Absenzen
      });
    }
  }
  if (rows.length === 0) return { added: 0 };

  const { error } = await supabase.from("time_entries").insert(rows);
  if (error) {
    console.error("autoBookFeiertage error:", error);
    return { added: 0 };
  }
  return { added: rows.length };
}
