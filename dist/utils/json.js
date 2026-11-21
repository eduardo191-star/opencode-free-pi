/** Safe JSON response parsing. */
export async function readJson(response) {
    try {
        return await response.json();
    }
    catch {
        return undefined;
    }
}
