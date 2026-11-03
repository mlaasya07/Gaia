import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_INIT_SCRIPT, THEME_STORE, ThemeProvider } from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "dark";
});
afterEach(cleanup);

describe("theme toggle", () => {
  it("switches from dark to light and back, and saves the choice", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORE)).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORE)).toBe("dark");
  });

  it("restores a saved light theme before the page paints", () => {
    localStorage.setItem(THEME_STORE, "light");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("keeps the dark default when nothing is saved", () => {
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
