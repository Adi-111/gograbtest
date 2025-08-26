// WhatsApp param types (Cloud API)
export type WAParam =
    | { type: "text"; text: string, parameter_name: "customer_name" }
    | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
    | { type: "date_time"; date_time: { fallback_value: string } }
    | { type: "image"; image: { link: string } }
    | { type: "video"; video: { link: string } }
    | { type: "document"; document: { link: string } }
    | { type: "location"; location: { longitude: number; latitude: number; name?: string; address?: string } };

export type WAComponent =
    | { type: "header"; parameters: WAParam[] }
    | { type: "body"; parameters: WAParam[] }
    | {
        type: "button";
        sub_type: "quick_reply" | "url";
        index: `${number}`;          // "0", "1", ...
        parameters?: { type: "text"; text: string }[]; // only for URL buttons
    };

export interface SendTemplateBody {
    to: string;

    // Back-compat fields (old shape)
    templateName?: string;                 // e.g., "request_check"
    languageCode?: string;                 // e.g., "en" or "en_US"
    parameters?: { type: "text"; text: string }[]; // old: body params only

    // New general shape (recommended)
    template?: {
        name: string;
        languageCode: string;
        components?: WAComponent[];
    };
}
