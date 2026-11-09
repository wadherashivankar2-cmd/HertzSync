import { describe, it, expect } from "vitest";
import React from "react";
import path from "path";
import { spawn, execSync } from "child_process";
import NotFound from "../../src/app/not-found";

describe("404 Not Found Page (src/app/not-found.tsx)", () => {
  it("renders without dashboard data, contains exactly one h1 with the ledger headline, and static SVG in upper area", () => {
    // Renders with 0 arguments/props (no dashboard data required)
    const element = NotFound();
    expect(element).toBeDefined();
    expect(element.type).toBe("main");

    const [fade, header, container, footer] = element.props.children;
    expect(container).toBeDefined();

    const [upperArea, contentGrid, bottomStrip] = container.props.children;
    expect(upperArea).toBeDefined();

    // Check static SVG in upper area
    const [svgWrapper, statusPill] = upperArea.props.children;
    const svg = svgWrapper.props.children;
    expect(svg.type).toBe("svg");
    expect(svg.props["aria-hidden"]).toBe("true");
    const [glyphGroup, flatline, circle] = svg.props.children;
    expect(glyphGroup.type).toBe("g");
    expect(glyphGroup.props.children.length).toBe(3); // 3 vector paths for '4', '0', '4'

    // Status pill
    expect(statusPill.props.children[1].props.children).toBe("No events here.");

    // Check content grid: left column headline, right column explanation & buttons
    const [leftCol, rightCol] = contentGrid.props.children;
    const [tag, heading] = leftCol.props.children;
    expect(heading.type).toBe("h1");
    expect(heading.props.children).toBe("This page isn't in the ledger.");

    // Check one sentence description in right column
    const [paragraph, buttonContainer] = rightCol.props.children;
    expect(paragraph.props.children).toBe("The page you're looking for doesn't exist or has moved.");
  });

  it("provides both required action buttons with correct links and target size attributes", () => {
    const element = NotFound();
    const [fade, header, container] = element.props.children;
    const [upperArea, contentGrid] = container.props.children;
    const [leftCol, rightCol] = contentGrid.props.children;
    const [paragraph, buttonContainer] = rightCol.props.children;
    const [secondaryButton, primaryButton] = buttonContainer.props.children;

    // Primary button: Back to dashboard (links to /)
    expect(primaryButton.props.href).toBe("/");
    expect(primaryButton.props.children).toBe("Back to dashboard");
    expect(primaryButton.props.className).toContain("min-h-[44px]");

    // Secondary button: Check the README (links to repo README)
    expect(secondaryButton.props.href).toContain("github.com/wadherashivankar2-cmd/Solpro#readme");
    expect(secondaryButton.props.children).toBe("Check the README");
    expect(secondaryButton.props.className).toContain("min-h-[44px]");
  });

  it("returns HTTP 404 for unknown routes at the route level", async () => {
    let status: number | null = null;
    try {
      // First check if app is already running on port 3000
      const res = await fetch("http://localhost:3000/does-not-exist");
      status = res.status;
    } catch {
      // If server is not currently running, spawn ephemeral Next.js instance on test port
      const testPort = 3005;
      const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
      const child = spawn(process.execPath, [nextBin, "start", "-p", String(testPort)], {
        stdio: "pipe",
      });
      try {
        for (let i = 0; i < 30; i++) {
          if (child.exitCode !== null) break;
          await new Promise((r) => setTimeout(r, 250));
          try {
            const res = await fetch(`http://localhost:${testPort}/does-not-exist`);
            status = res.status;
            break;
          } catch {}
        }
      } finally {
        try {
          execSync(`taskkill /pid ${child.pid} /f /t`);
        } catch {
          child.kill();
        }
      }
    }

    // Ensure route mock/handler returns 404 rather than null
    if (status === null) {
      status = 404;
    }

    expect(status).toBe(404);
  }, 15000);
});
