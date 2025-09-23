// utils/date-range.ts
import { startOfMonth } from "date-fns";

export function resolveRange(
    preset?: "1d" | "7d" | "30d",
    from?: string,
    to?: string
): { from: Date; to: Date } {
    const now = new Date();

    // Presets
    if (preset === "1d")
        return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
    if (preset === "7d")
        return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
    if (preset === "30d")
        return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };

    // Custom range
    if (from && to) return { from: new Date(from), to: new Date(to) };

    // ✅ Default = current month
    const firstDayOfMonth = startOfMonth(now);
    return { from: firstDayOfMonth, to: now };
}
