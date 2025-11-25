// utils/date-range.ts
import { startOfDay, startOfMonth, addMinutes, subDays } from "date-fns";

/**
 * Utility to resolve a date range either from a preset or from explicit params.
 * All returned Date objects are IST-corrected (shifted from UTC).
 */
export function resolveRange(
    preset?: "1d" | "7d" | "30d",
    from?: string,
    to?: string
) {
    const nowUTC = new Date();

    // Convert "now" to IST reference
    const IST_OFFSET_MINUTES = 5 * 60 + 30;
    const nowIST = addMinutes(nowUTC, IST_OFFSET_MINUTES);

    let fromIST: Date;
    let toIST = nowIST;

    switch (preset) {
        case "1d":
            fromIST = subDays(nowIST, 1);
            break;
        case "7d":
            fromIST = subDays(nowIST, 7);
            break;
        case "30d":
            fromIST = subDays(nowIST, 30);
            break;
        default:
            // ✅ Default = start of current month (in IST)
            fromIST = startOfMonth(startOfDay(nowIST));
            break;
    }

    // Custom range overrides presets if provided
    if (from && to) {
        fromIST = addMinutes(new Date(from), IST_OFFSET_MINUTES);
        toIST = addMinutes(new Date(to), IST_OFFSET_MINUTES);
    }

    // Shift back to UTC for DB queries (we store UTC)
    return toISTRange(fromIST, toIST,);
}

/**
 * Converts a Date (assumed UTC or IST) to IST window bounds.
 * Shifts the Date by +5h30m to align with Indian Standard Time,
 * returning both shifted values.
 */
export function toISTRange(from: Date, to: Date) {
    const IST_OFFSET_MINUTES = 5 * 60 + 30;
    return {
        fromIST: addMinutes(from, -IST_OFFSET_MINUTES),
        toIST: addMinutes(to, -IST_OFFSET_MINUTES),
    };
}
