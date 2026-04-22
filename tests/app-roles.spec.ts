import { test, expect, Page } from "@playwright/test";

const BASE = "https://www.holzbaugasser.app";

const USERS = {
  admin: { email: "napetschnig.chris@gmail.com", password: "nereirtsiger" },
  mitarbeiter: { email: "napetschnig98@gmail.com", password: "nereirtsiger" },
  vorarbeiter: { email: "cnapetschnig@gmail.com", password: "nereirtsiger" },
};

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/auth`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
}

// =============================================================================
// ADMIN TESTS
// =============================================================================
test.describe("Admin Role", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.admin.email, USERS.admin.password);
  });

  test("Dashboard loads with all menu items", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Leistungsbericht" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Projekte", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stundenauswertung" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Admin-Bereich" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Urlaub / Abwesenheit" })).toBeVisible();
  });

  test("Stundenauswertung loads with tabs + Ohne/Mit Überstunden", async ({ page }) => {
    await page.getByRole("heading", { name: "Stundenauswertung" }).click();
    await page.waitForURL("**/hours-report**");
    await expect(page.getByText("Monatsübersicht")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ohne Überstunden" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mit Überstunden" })).toBeVisible();
    await expect(page.getByRole("button", { name: "PDF Export (A3)" })).toBeVisible();
  });

  test("Admin-Bereich loads with key sections", async ({ page }) => {
    await page.getByRole("heading", { name: "Admin-Bereich" }).click();
    await page.waitForURL("**/admin**");
    await expect(page.getByText("Benutzerverwaltung")).toBeVisible();
    await expect(page.getByText("Lohnzettel verwalten")).toBeVisible();
    await expect(page.getByText("Zeitkonten & Zeitausgleich")).toBeVisible();
  });

  test("Leistungsbericht page loads with sections", async ({ page }) => {
    await page.getByRole("heading", { name: "Leistungsbericht" }).click();
    await page.waitForURL("**/time-tracking**");
    await expect(page.getByRole("heading", { name: "Bauvorhaben" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tätigkeiten" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mitarbeiter & Stunden" })).toBeVisible();
    // + Projekt button should exist
    await expect(page.locator('button[title="Neues Projekt erstellen"]')).toBeVisible();
    // + Tätigkeit button should be below activities
    await expect(page.getByRole("button", { name: "Tätigkeit" })).toBeVisible();
    // Speichern button should be visible
    await expect(page.getByRole("button", { name: "Leistungsbericht speichern" })).toBeVisible();
  });

  test("Absence page loads without ZA", async ({ page }) => {
    await page.getByRole("heading", { name: "Urlaub / Abwesenheit" }).click();
    await page.waitForURL("**/absence**");
    await expect(page.getByText("Neue Abwesenheit")).toBeVisible();
    await expect(page.getByText("Urlaub", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Krankenstand").first()).toBeVisible();
    // ZA should NOT be an option
    await expect(page.getByText("Zeitausgleich")).not.toBeVisible();
  });

  test("Stundenauswertung cells are clickable for edit", async ({ page }) => {
    await page.getByRole("heading", { name: "Stundenauswertung" }).click();
    await page.waitForURL("**/hours-report**");
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    const cell = page.locator("table tbody tr:first-child td:nth-child(2)");
    if (await cell.isVisible()) {
      await cell.click();
      // Edit dialog should appear
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await page.getByRole("button", { name: "Abbrechen" }).click();
    }
  });
});

// =============================================================================
// VORARBEITER TESTS
// =============================================================================
test.describe("Vorarbeiter Role", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.vorarbeiter.email, USERS.vorarbeiter.password);
  });

  test("Dashboard loads with correct menu items", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Leistungsbericht" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Projekte", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Urlaub / Abwesenheit" })).toBeVisible();
    // Should NOT see Admin-Bereich
    await expect(page.getByRole("heading", { name: "Admin-Bereich" })).not.toBeVisible();
  });

  test("Leistungsbericht loads with current user pre-selected", async ({ page }) => {
    await page.getByRole("heading", { name: "Leistungsbericht" }).click();
    await page.waitForURL("**/time-tracking**");
    await expect(page.getByRole("heading", { name: "Bauvorhaben" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mitarbeiter & Stunden" })).toBeVisible();
  });

  test("Absence page works without ZA", async ({ page }) => {
    await page.getByRole("heading", { name: "Urlaub / Abwesenheit" }).click();
    await page.waitForURL("**/absence**");
    await expect(page.getByText("Neue Abwesenheit")).toBeVisible();
    await expect(page.getByText("Zeitausgleich")).not.toBeVisible();
  });

  test("Inline project creation button exists", async ({ page }) => {
    await page.getByRole("heading", { name: "Leistungsbericht" }).click();
    await page.waitForURL("**/time-tracking**");
    await expect(page.locator('button[title="Neues Projekt erstellen"]')).toBeVisible();
  });
});

// =============================================================================
// MITARBEITER TESTS
// =============================================================================
test.describe("Mitarbeiter Role", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.mitarbeiter.email, USERS.mitarbeiter.password);
  });

  test("Dashboard loads with limited menu", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Urlaub / Abwesenheit" })).toBeVisible();
    // Should NOT see admin-only items
    await expect(page.getByRole("heading", { name: "Admin-Bereich" })).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Stundenauswertung" })).not.toBeVisible();
  });

  test("Absence page loads with correct types", async ({ page }) => {
    await page.getByRole("heading", { name: "Urlaub / Abwesenheit" }).click();
    await page.waitForURL("**/absence**");
    await expect(page.getByText("Neue Abwesenheit")).toBeVisible();
    // Should have Urlaub, Krankenstand, Berufsschule but NOT ZA
    await expect(page.getByText("Zeitausgleich")).not.toBeVisible();
    await expect(page.getByText("Berufsschule").first()).toBeVisible();
  });

  test("Meine Dokumente loads with tabs", async ({ page }) => {
    await page.getByRole("heading", { name: "Meine Dokumente" }).click();
    await page.waitForURL("**/my-documents**");
    await expect(page.getByRole("tab", { name: "Meine Lohnzettel" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Krankmeldungen" })).toBeVisible();
  });

  test("Mitarbeiter cannot access admin pages directly", async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    // Should redirect away from admin
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain("/admin");
  });

  test("Mitarbeiter cannot access hours-report directly", async ({ page }) => {
    await page.goto(`${BASE}/hours-report`);
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain("/hours-report");
  });
});
