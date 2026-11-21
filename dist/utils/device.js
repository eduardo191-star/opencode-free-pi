/** Device metadata reported to free-pi during sign-in. */
export function deviceReport() {
    try {
        const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
        return {
            ...(timeZone ? { timezone: timeZone } : {}),
            ...(locale ? { locale } : {}),
        };
    }
    catch {
        return {};
    }
}
export function adClientHeaders() {
    const headers = {};
    if (process.platform)
        headers["x-client-os"] = process.platform;
    if (process.arch)
        headers["x-client-arch"] = process.arch;
    try {
        const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
        if (timeZone)
            headers["x-client-timezone"] = timeZone;
        if (locale)
            headers["x-client-locale"] = locale;
    }
    catch { }
    return headers;
}
