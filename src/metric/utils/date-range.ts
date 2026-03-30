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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the UTC instant for 00:00:01 IST on the current IST calendar day.
 */
function getStartOfTodayIST(): Date {
    const nowUTC = new Date();
    const istNow = new Date(nowUTC.getTime() + IST_OFFSET_MS);
    const y = istNow.getUTCFullYear();
    const m = istNow.getUTCMonth();
    const d = istNow.getUTCDate();
    return new Date(Date.UTC(y, m, d, 0, 0, 1, 0) - IST_OFFSET_MS);
}

/**
 * Utility to resolve a date range either from a preset or from explicit params.
 * Returns UTC Date objects for database queries, but respects IST day/month boundaries.
 *
 * - "today" → 00:00:01 IST today to current time
 * - "1d" → last 24 hours (current time - 24h to current time)
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
            // 00:00:01 IST today to current time (IST day boundary, 1s past midnight)
            rangeFromIST = new Date(getStartOfTodayIST().getTime() + IST_OFFSET_MS);
            break;
        case "1d":
            // Rolling 24 hours: (now - 24h) to now
            rangeFromIST = new Date(nowUTC.getTime() - ONE_DAY_MS + IST_OFFSET_MS);
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
