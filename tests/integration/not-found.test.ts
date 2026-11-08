import { describe, it, expect } from "vitest";
import React from "react";
import NotFound from "../../src/app/not-found";

describe("404 Not Found Page (src/app/not-found.tsx)", () => {
  it("renders the 404 page with existing design tokens and a link back to '/'", () => {
    const element = NotFound();
    expect(element).toBeDefined();
    expect(element.type).toBe("main");

    // Children inspect
    const container = element.props.children;
    expect(container).toBeDefined();

    const [badge, heading, paragraph, link] = container.props.children;
    expect(heading.props.children).toBe("Page Not Found");
    expect(paragraph.props.children).toContain("The requested route does not exist");
    expect(link.props.href).toBe("/");
    expect(link.props.children).toBe("Return to Dashboard");
  });
});
