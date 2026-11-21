/**
 * Logs the two server notices the free-pi CLI watches for: the
 * `x-freepi-notice` header and the `: freepi_notice` SSE marker sent when the
 * server restarts.
 */
const NOTICE_HEADER = "x-freepi-notice";
const SSE_NOTICE = "freepi_notice";
export function watchFreePiNotice(deps, response) {
    const notice = response.headers.get(NOTICE_HEADER);
    if (notice)
        deps.log.info("free-pi server notice", { notice });
    const type = response.headers.get("content-type") ?? "";
    if (!response.body || !type.includes("text/event-stream"))
        return response;
    const decoder = new TextDecoder();
    let reported = false;
    const body = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            if (!reported) {
                const text = decoder.decode(chunk, { stream: true });
                if (text.includes(SSE_NOTICE)) {
                    reported = true;
                    deps.log.warn("free-pi server sent a restart notice");
                }
            }
            controller.enqueue(chunk);
        },
    }));
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
