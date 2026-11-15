// Pure helpers over the response shape lib/http.js answers.

export function isSuccess(status) {
    return status >= 200 && status < 300;
}

export function bodyText(res) {
    return new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
}
