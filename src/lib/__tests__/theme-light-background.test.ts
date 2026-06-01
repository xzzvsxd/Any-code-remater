import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function extractLightThemeBlock(css: string): string {
  const match = css.match(/\.light\s*\{(?<body>[\s\S]*?)\n\}/);
  return match?.groups?.body ?? "";
}

function getCssVariable(block: string, variableName: string): string {
  const escapedVariableName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedVariableName}\\s*:\\s*([^;]+);`);
  return block.match(pattern)?.[1]?.trim() ?? "";
}

describe("light theme background", () => {
  it("keeps the light app canvas neutral white instead of warm orange", () => {
    const lightTheme = extractLightThemeBlock(readRepoFile("src/styles/theme.css"));

    expect(getCssVariable(lightTheme, "--color-background")).toBe("oklch(0.985 0.002 240)");
    expect(getCssVariable(lightTheme, "--surface-canvas")).toBe("oklch(0.985 0.002 240)");
    expect(getCssVariable(lightTheme, "--surface-sidebar")).toBe("oklch(0.965 0.003 240)");
    expect(getCssVariable(lightTheme, "--surface-panel")).toBe("oklch(1 0 0)");
    expect(getCssVariable(lightTheme, "--surface-assistant")).toBe("oklch(1 0 0)");
  });

  it("does not paint the expensive decorative mesh over the light theme", () => {
    const appLayout = readRepoFile("src/components/layout/AppLayout.tsx");

    expect(appLayout).toContain('className="absolute inset-0 pointer-events-none z-0 hidden dark:block"');
    expect(appLayout).not.toContain("from-primary/10 via-background to-background");
  });

  it("does not force smooth scrolling on the main workbench viewport", () => {
    const appLayout = readRepoFile("src/components/layout/AppLayout.tsx");

    expect(appLayout).not.toContain("scroll-smooth");
  });
});
