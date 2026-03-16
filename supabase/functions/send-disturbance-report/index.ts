import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Material {
  id: string;
  material: string;
  menge: string | null;
  notizen: string | null;
}

interface Photo {
  id: string;
  file_path: string;
  file_name: string;
}

interface Disturbance {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  stunden: number;
  kunde_name: string;
  kunde_email: string | null;
  kunde_adresse: string | null;
  kunde_telefon: string | null;
  beschreibung: string;
  notizen: string | null;
  unterschrift_kunde: string;
}

interface ReportRequest {
  disturbance: Disturbance;
  materials: Material[];
  technicianNames?: string[];
  technicianName?: string;
  photos?: Photo[];
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-AT", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-AT", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) binary += String.fromCharCode(uint8Array[i]);
    const base64 = btoa(binary);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

async function generatePDF(data: ReportRequest & { technicians: string[] }, photoImages: (string | null)[]): Promise<string> {
  const { disturbance, materials, technicians, photos } = data;

  // Dynamic import avoids module-level crash in Deno (no top-level import needed)
  const { jsPDF } = await import("https://esm.sh/jspdf@2.5.2");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const cW = pageW - 2 * margin;

  const BLACK  = { r: 20,  g: 20,  b: 20  };
  const GRAY   = { r: 110, g: 110, b: 110 };
  const DGRAY  = { r: 74,  g: 74,  b: 74  }; // #4a4a4a – logo text
  const MGRAY  = { r: 106, g: 106, b: 106 }; // #6a6a6a – logo subtitle
  const D1     = { r: 90,  g: 90,  b: 90  }; // #5a5a5a – upper diamond
  const D2     = { r: 46,  g: 46,  b: 46  }; // #2e2e2e – lower diamond
  const LGRAY  = { r: 240, g: 240, b: 240 };
  const WHITE  = { r: 255, g: 255, b: 255 };
  const ACCENT = { r: 74,  g: 74,  b: 74  }; // #4a4a4a – matches logo text

  let y = 0;

  const setTxt  = (c: {r:number,g:number,b:number}) => doc.setTextColor(c.r, c.g, c.b);
  const setFill = (c: {r:number,g:number,b:number}) => doc.setFillColor(c.r, c.g, c.b);
  const setDraw = (c: {r:number,g:number,b:number}) => doc.setDrawColor(c.r, c.g, c.b);

  // Draw a diamond (rotated square) using polygon
  function drawDiamond(cx: number, cy: number, hw: number, hh: number, fillColor: {r:number,g:number,b:number}) {
    setFill(fillColor);
    setDraw(fillColor);
    doc.setLineWidth(0);
    // top → right → bottom → left → close
    doc.lines([[hw, hh], [-hw, hh], [-hw, -hh]], cx - hw + hw, cy - hh, [1, 1], "F", true);
    // jsPDF lines: from (cx, cy-hh), vectors to trace the diamond
    doc.lines([[hw, hh], [-hw, hh], [-hw, -hh]], cx, cy - hh, [1, 1], "F", true);
  }

  function sectionHeader(title: string) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setTxt(BLACK);
    doc.text(title, margin, y);
    setDraw(ACCENT);
    doc.setLineWidth(0.5);
    doc.line(margin, y + 1.5, margin + cW, y + 1.5);
    setDraw({ r: 180, g: 180, b: 180 });
    doc.setLineWidth(0.1);
    y += 7;
  }

  function fieldLabel(label: string, xPos = margin) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTxt(GRAY);
    doc.text(label.toUpperCase(), xPos, y);
  }

  function fieldValue(val: string, xPos = margin, maxW = cW): number {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTxt(BLACK);
    const lines = doc.splitTextToSize(val, maxW);
    doc.text(lines, xPos, y + 4);
    return lines.length;
  }

  function checkPage(needed = 35) {
    if (y + needed > pageH - 18) { doc.addPage(); y = 20; }
  }

  // ── Header ──────────────────────────────────────────────────────────────
  // Green accent bar at top
  setFill(D2);
  doc.rect(0, 0, pageW, 2, "F");

  // Logo: two overlapping diamonds + company name
  const lx = margin; // logo left edge
  const ly = 10;     // logo top area

  // Upper diamond (lighter gray) – positioned slightly right & up
  drawDiamond(lx + 8, ly + 6, 5.5, 5.5, D1);
  // Lower diamond (darker gray) – offset down-left for overlap effect
  drawDiamond(lx + 5, ly + 11, 5.5, 5.5, D2);

  // Company name to the right of the diamonds
  const txtX = lx + 17;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setTxt(DGRAY);
  doc.text("HOLZBAU GASSER", txtX, ly + 8);
  // Separator line under company name
  setDraw({ r: 122, g: 122, b: 122 });
  doc.setLineWidth(0.3);
  doc.line(txtX, ly + 10, txtX + 42, ly + 10);
  // Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTxt(MGRAY);
  doc.text("Holzbau", txtX, ly + 16);

  // Document title on the right
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setTxt(BLACK);
  doc.text("REGIEBERICHT", pageW - margin, 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setTxt(GRAY);
  doc.text(formatDate(disturbance.datum), pageW - margin, 21, { align: "right" });

  // Separator
  setDraw({ r: 180, g: 180, b: 180 });
  doc.setLineWidth(0.3);
  doc.line(margin, 33, margin + cW, 33);

  y = 42;

  const col2x = margin + cW / 2 + 3;
  const colW  = cW / 2 - 5;

  // ── Kundendaten ──────────────────────────────────────────────────────────
  sectionHeader("Kundendaten");
  fieldLabel("Name");
  const nameLines = fieldValue(disturbance.kunde_name, margin, colW);
  if (disturbance.kunde_adresse) { fieldLabel("Adresse", col2x); fieldValue(disturbance.kunde_adresse, col2x, colW); }
  y += nameLines * 4.5 + 4;
  if (disturbance.kunde_telefon || disturbance.kunde_email) {
    if (disturbance.kunde_telefon) { fieldLabel("Telefon"); fieldValue(disturbance.kunde_telefon, margin, colW); }
    if (disturbance.kunde_email)   { fieldLabel("E-Mail", col2x); fieldValue(disturbance.kunde_email, col2x, colW); }
    y += 9;
  }
  y += 5;

  // ── Einsatzdaten ─────────────────────────────────────────────────────────
  checkPage(55);
  sectionHeader("Einsatzdaten");
  const st = disturbance.start_time.slice(0, 5);
  const et = disturbance.end_time.slice(0, 5);

  // Row 1: Datum | Arbeitszeit
  fieldLabel("Datum"); fieldValue(formatDate(disturbance.datum), margin, colW);
  fieldLabel("Arbeitszeit", col2x); fieldValue(`${st} – ${et} Uhr`, col2x, colW);
  y += 9;

  // Row 2: Pause (left) | Mitarbeiter (right)
  if (disturbance.pause_minutes > 0) {
    fieldLabel("Pause"); fieldValue(`${disturbance.pause_minutes} Minuten`, margin, colW);
  }
  fieldLabel("Mitarbeiter", col2x); fieldValue(technicians.join(", "), col2x, colW);
  y += 9;

  // Row 3: Gesamtstunden – prominently below, full width
  y += 2;
  setFill(LGRAY);
  setDraw(DGRAY);
  doc.setLineWidth(0.4);
  doc.rect(margin, y - 3, cW, 16, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); setTxt(DGRAY);
  doc.text("GESAMTSTUNDEN", margin + 4, y + 1);
  doc.setFontSize(15); setTxt(BLACK);
  doc.text(`${disturbance.stunden.toFixed(2)} h`, margin + 4, y + 10);
  y += 20;

  // ── Durchgeführte Arbeiten ────────────────────────────────────────────────
  checkPage(40);
  sectionHeader("Durchgeführte Arbeiten");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); setTxt(BLACK);
  const bLines = doc.splitTextToSize(disturbance.beschreibung, cW - 4);
  const bH = bLines.length * 4.8 + 6;
  setFill(LGRAY); setDraw({ r: 180, g: 180, b: 180 }); doc.setLineWidth(0.2);
  doc.rect(margin, y - 2, cW, bH, "FD");
  doc.text(bLines, margin + 3, y + 2.5);
  y += bH + 5;

  if (disturbance.notizen) {
    checkPage(20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); setTxt(GRAY);
    doc.text("NOTIZEN", margin, y); y += 4;
    doc.setFont("helvetica", "italic"); doc.setFontSize(9); setTxt({ r: 60, g: 60, b: 60 });
    const nLines = doc.splitTextToSize(disturbance.notizen, cW);
    doc.text(nLines, margin, y); y += nLines.length * 4.8 + 6;
  }

  // ── Materialien ───────────────────────────────────────────────────────────
  if (materials && materials.length > 0) {
    checkPage(30); y += 4;
    sectionHeader("Verwendete Materialien");
    const c1 = cW * 0.45; const c2 = cW * 0.2; const c3 = cW * 0.35;
    setFill(LGRAY); doc.rect(margin, y - 3, cW, 7, "F");
    setDraw({ r: 160, g: 160, b: 160 }); doc.setLineWidth(0.2); doc.rect(margin, y - 3, cW, 7, "S");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); setTxt(BLACK);
    doc.text("Material", margin + 2, y + 1);
    doc.text("Menge", margin + c1 + 2, y + 1);
    doc.text("Notizen", margin + c1 + c2 + 2, y + 1);
    y += 7;
    materials.forEach((mat) => {
      checkPage(8);
      setDraw({ r: 200, g: 200, b: 200 }); doc.setLineWidth(0.1);
      doc.line(margin, y + 4, margin + cW, y + 4);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); setTxt(BLACK);
      doc.text(doc.splitTextToSize(mat.material || "-", c1 - 4), margin + 2, y);
      doc.text(mat.menge || "-", margin + c1 + 2, y);
      doc.text(doc.splitTextToSize(mat.notizen || "-", c3 - 4), margin + c1 + c2 + 2, y);
      y += 7;
    });
    setDraw({ r: 160, g: 160, b: 160 }); doc.setLineWidth(0.3);
    doc.line(margin, y, margin + cW, y); y += 6;
  }

  // ── Fotos ─────────────────────────────────────────────────────────────────
  if (photos && photos.length > 0 && photoImages.some(img => img !== null)) {
    doc.addPage(); y = 20;
    sectionHeader("Fotos");
    const imgW = (cW - 5) / 2; const imgH = imgW * 0.75;
    let col = 0;
    for (let i = 0; i < photos.length; i++) {
      const imageData = photoImages[i];
      if (!imageData) continue;
      if (col === 2) { col = 0; y += imgH + 12; checkPage(imgH + 15); }
      const xImg = margin + col * (imgW + 5);
      try {
        doc.addImage(imageData, "JPEG", xImg, y, imgW, imgH);
        setDraw({ r: 180, g: 180, b: 180 }); doc.setLineWidth(0.2);
        doc.rect(xImg, y, imgW, imgH, "S");
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); setTxt(GRAY);
        const fn = photos[i].file_name.length > 30 ? photos[i].file_name.slice(0, 28) + "…" : photos[i].file_name;
        doc.text(fn, xImg, y + imgH + 4);
      } catch { /* skip */ }
      col++;
    }
    y += imgH + 14;
  }

  // ── Kundenunterschrift ────────────────────────────────────────────────────
  checkPage(70); y += 6;
  sectionHeader("Kundenunterschrift");

  // White signature box with gray border
  setFill(WHITE); setDraw({ r: 160, g: 160, b: 160 }); doc.setLineWidth(0.4);
  doc.rect(margin, y - 2, cW, 40, "FD");

  if (disturbance.unterschrift_kunde) {
    try {
      // Strip the data URL prefix – pass raw base64 to avoid Deno rendering issues
      const sig = disturbance.unterschrift_kunde;
      const b64 = sig.startsWith("data:") ? sig.split(",")[1] : sig;
      doc.addImage(b64, "PNG", margin + 4, y, cW - 8, 35);
    } catch (imgErr) {
      console.error("Signature image error:", imgErr instanceof Error ? imgErr.message : String(imgErr));
      doc.setFont("helvetica", "italic"); doc.setFontSize(9); setTxt(GRAY);
      doc.text("[Unterschrift vorhanden]", margin + 5, y + 18);
    }
  }
  y += 45;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); setTxt(GRAY);
  doc.text(`Datum: ${new Date().toLocaleDateString("de-AT")}`, margin, y); y += 5;
  doc.text(doc.splitTextToSize("Der Kunde bestätigt mit seiner Unterschrift die ordnungsgemäße Durchführung der oben angeführten Arbeiten.", cW), margin, y);

  // ── Footer on every page ──────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    setDraw({ r: 180, g: 180, b: 180 }); doc.setLineWidth(0.3);
    doc.line(margin, pageH - 12, margin + cW, pageH - 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); setTxt(GRAY);
    doc.text(`Holzbau Gasser  |  Erstellt am: ${new Date().toLocaleDateString("de-AT")}`, margin, pageH - 7);
    doc.text(`Seite ${p} / ${totalPages}`, pageW - margin, pageH - 7, { align: "right" });
  }

  return doc.output("datauristring").split(",")[1];
}

function generateEmailHtml(data: ReportRequest & { technicians: string[] }): string {
  const { disturbance, technicians } = data;
  const technicianDisplay = technicians.length === 1 ? technicians[0] : technicians.join(", ");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      body { font-family: Arial, sans-serif; color: #333; line-height: 1.5; }
      .header { color: #4a4a4a; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .info-box { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
    </style></head>
    <body><div class="container">
      <div class="header">HOLZBAU GASSER</div>
      <h2>Regiebericht</h2>
      <p>Sehr geehrte Damen und Herren,</p>
      <p>im Anhang finden Sie den Regiebericht für den Einsatz bei <strong>${disturbance.kunde_name}</strong> vom <strong>${formatDate(disturbance.datum)}</strong>.</p>
      <div class="info-box">
        <strong>Zusammenfassung:</strong><br>
        Techniker: ${technicianDisplay}<br>
        Arbeitszeit: ${disturbance.start_time.slice(0, 5)} - ${disturbance.end_time.slice(0, 5)} Uhr<br>
        Gesamtstunden: ${disturbance.stunden.toFixed(2)} h
      </div>
      <p>Der vollständige Bericht mit Kundenunterschrift befindet sich im angehängten PDF-Dokument.</p>
      <p>Mit freundlichen Grüßen,<br>Holzbau Gasser</p>
    </div></body></html>`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { disturbance, materials, technicianNames, technicianName, photos }: ReportRequest = await req.json();

    const technicians = technicianNames?.length ? technicianNames :
                        technicianName ? [technicianName] : ["Techniker"];

    if (!disturbance || !disturbance.unterschrift_kunde) {
      return new Response(
        JSON.stringify({ error: "Disturbance data and signature required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Processing disturbance report:", disturbance.id);

    // Fetch photo images
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const photoImages: (string | null)[] = [];
    if (photos && photos.length > 0) {
      for (const photo of photos) {
        const url = `${supabaseUrl}/storage/v1/object/public/disturbance-photos/${photo.file_path}`;
        photoImages.push(await fetchImageAsBase64(url));
      }
    }

    // Generate PDF — if it fails, email is sent without attachment
    let pdfBase64: string | null = null;
    try {
      pdfBase64 = await generatePDF({ disturbance, materials, technicians, photos }, photoImages);
      console.log("PDF generated successfully");
    } catch (pdfError) {
      console.error("PDF generation failed, sending without PDF:", pdfError instanceof Error ? pdfError.message : String(pdfError));
    }

    const emailHtml = generateEmailHtml({ disturbance, materials, technicians });

    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "disturbance_report_email")
      .maybeSingle();

    const officeEmail = setting?.value || "fabian.gasser@holzbau-gasser.at";
    const recipients = [officeEmail];
    if (disturbance.kunde_email) recipients.push(disturbance.kunde_email);

    const dateForFilename = formatDateShort(disturbance.datum).replace(/\./g, "-");
    const kundeForFilename = disturbance.kunde_name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "_");
    const pdfFilename = `Regiebericht_${kundeForFilename}_${dateForFilename}.pdf`;
    const subject = `Regiebericht - ${disturbance.kunde_name} - ${formatDateShort(disturbance.datum)}`;

    console.log("Sending email to:", recipients, "| PDF:", pdfBase64 !== null);

    const emailPayload: {
      from: string;
      reply_to: string;
      to: string[];
      subject: string;
      html: string;
      attachments?: { filename: string; content: string }[];
    } = {
      from: "Holzbau Gasser <noreply@chrisnapetschnig.at>",
      reply_to: "fabian.gasser@holzbau-gasser.at",
      to: recipients,
      subject,
      html: emailHtml,
    };

    if (pdfBase64) {
      emailPayload.attachments = [{ filename: pdfFilename, content: pdfBase64 }];
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend API error:", resendData);
      return new Response(
        JSON.stringify({ error: `E-Mail Fehler: ${resendData?.message || resendData?.name || JSON.stringify(resendData)}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Email sent successfully:", resendData);

    return new Response(
      JSON.stringify({ success: true, emailId: resendData?.id }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
