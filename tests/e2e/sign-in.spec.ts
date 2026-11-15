import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readCode } from "../helpers/mailpit";

// The whole first-visit path in a real browser: signed out, email-code sign-in (code read from
// Mailpit), the /welcome name form, the trips page, then sign out.

test("sign in with an emailed code, name yourself on /welcome, sign out", async ({ page }) => {
  const email = `browser-${randomUUID().slice(0, 8)}@example.test`;

  // Signed out, /welcome sends you to sign in.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in to Layover" })).toBeVisible();

  // A wrong code is refused with a message and does not sign you in.
  await page.getByRole("button", { name: "Use email instead" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const codeInput = page.getByLabel("6-digit code");
  await expect(codeInput).toBeVisible();

  const code = await readCode(email);
  const wrong = code === "000000" ? "111111" : "000000";
  await codeInput.fill(wrong);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("That code did not work");
  await expect(page).toHaveURL(/\/sign-in/);

  // The real code signs in. A new account has no name yet, so it lands on /welcome.
  await codeInput.fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: "Welcome to Layover" })).toBeVisible();

  // Whitespace only is not a name: the server rejects it and shows the message.
  const name = page.getByLabel("What should your group call you?");
  await name.fill("   ");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Enter a name between 1 and 80 characters.");
  await expect(page).toHaveURL(/\/welcome/);

  // A real name saves and moves on to the trips page, which greets the person by it.
  await name.fill("Pat Playwright");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await expect(page.getByText("Signed in as Pat Playwright")).toBeVisible();

  // With a name set, /welcome has nothing to ask.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/trips$/);

  // Sign out returns to the home page and closes the trips page again.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/trips");
  await expect(page).toHaveURL(/\/sign-in/);
});
