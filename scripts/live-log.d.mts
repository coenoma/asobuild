/** 収録カンペ（/live）へ流す共通の書き込み口。実体は live-log.mjs */
export declare function live(event: Record<string, unknown>): Promise<void>;
export declare function say(text: string): Promise<void>;
