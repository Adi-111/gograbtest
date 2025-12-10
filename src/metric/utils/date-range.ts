// utils/date-range.ts
import { startOfDay, startOfMonth, subDays } from "date-fns";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 5h 30m in milliseconds

/**
 * Convert a UTC Date to IST-equivalent Date object.
 * Use this when you need to compute IST day/month boundaries.
 */
function toIST(date: Date): Date {
    return new Date(date.getTime() + IST_OFFSET_MS);
}

/**
 * Convert an IST-based Date back to UTC for DB queries.
 * Database stores timestamps in UTC.
 */
function istToUTC(istDate: Date): Date {
    return new Date(istDate.getTime() - IST_OFFSET_MS);
}

/**
 * Utility to resolve a date range either from a preset or from explicit params.
 * Returns UTC Date objects for database queries, but respects IST day/month boundaries.
 * 
 * Example: At 12:05 AM IST on Dec 7:
 * - "today" preset → Dec 7 00:00 IST to now = Dec 6 18:30 UTC to Dec 6 18:35 UTC
 * - "1d" preset → rolling 24 hours back
 */
export function resolveRange(
    preset?: "today" | "1d" | "7d" | "30d",
    from?: string,
    to?: string
) {
    const nowUTC = new Date();
    const nowInIST = toIST(nowUTC);

    let rangeFromIST: Date;
    let rangeToIST: Date = nowInIST;

    switch (preset) {
        case "today":
            // Start of today in IST (midnight IST)
            rangeFromIST = startOfDay(nowInIST);
            break;
        case "1d":
            // Rolling 24 hours (but from IST day start for consistency)
            rangeFromIST = startOfDay(subDays(nowInIST, 1));
            break;
        case "7d":
            rangeFromIST = startOfDay(subDays(nowInIST, 7));
            break;
        case "30d":
            rangeFromIST = startOfDay(subDays(nowInIST, 30));
            break;
        default:
            // Default = start of current month in IST
            rangeFromIST = startOfMonth(nowInIST);
            break;
    }

    // Custom range overrides presets if provided
    // Assume user passes IST-intended date strings (e.g., "2024-12-01")
    if (from && to) {
        rangeFromIST = new Date(from);
        rangeToIST = new Date(to);
    }

    // Convert IST boundaries back to UTC for database queries
    return {
        fromIST: istToUTC(rangeFromIST),
        toIST: istToUTC(rangeToIST),
    };
}
