// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);
import { DateFormatSettings } from "@/components/settings/DateFormatSettings";

describe("DateFormatSettings", () => {
  it("previews today in the saved format and preselects it", () => {
    render(<DateFormatSettings prefs={{ order: "MDY", month: "long" }} example="2026-10-21" action={async () => null} />);
    expect(screen.getByTestId("date-example").textContent).toBe("October 21 2026");
    expect((screen.getByLabelText("Order") as HTMLSelectElement).value).toBe("MDY");
    expect((screen.getByLabelText("Month") as HTMLSelectElement).value).toBe("long");
  });
  it("offers exactly three orders and three month styles", () => {
    render(<DateFormatSettings prefs={{ order: "DMY", month: "short" }} example="2026-10-21" action={async () => null} />);
    expect((screen.getByLabelText("Order") as HTMLSelectElement).options).toHaveLength(3);
    expect((screen.getByLabelText("Month") as HTMLSelectElement).options).toHaveLength(3);
  });
});
