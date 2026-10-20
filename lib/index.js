/**
 * New API / One API relay balance for DeepSeek Harness.
 *
 * Host half: one read-only route, `/api/newapi-balance`, that asks the relay
 * what this account (or this key) is worth right now.
 *
 * Two ways to read a New API site, both verified against a live deployment:
 *
 * - **Account balance** — `GET /api/user/self` with an access token
 *   (`Authorization: Bearer <token>`) and the numeric user id in `New-Api-User`.
 *   This is what CC Switch's "NewAPI" usage template does.
 * - **Key usage** — `GET /api/usage/token/` with the ordinary `sk-` key. New
 *   API puts it behind TokenAuthReadOnly, so the key this profile already
 *   holds for the route is enough; `unlimited_quota` keys report usage only.
 *
 * Both answer in `quota`, an internal integer whose money value depends on the
 * site: `USD = quota / quota_per_unit` and `CNY = USD * price`, both read from
 * `/api/status`. The two conversions are kept separate so a site that charges
 * in CNY is not displayed as if it charged in USD.
 *
 * The route only answers loopback callers, for the same reason the other panel
 * routes do: it is registered as an exact path, outside the RPC auth boundary.
 *
 * @module dsh-newapi-balance
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const name = "newapi-balance";

/**
 * The config schema is optional on purpose: a bare `apply` with a plain object
 * still mounts, which keeps this file importable outside the harness (the
 * schema package only exists in the host's graph).
 */
let z;
try {
	z = (await import("@deepseek-ai/schemastery")).default;
} catch {
	z = undefined;
}

export const Config = z === undefined
	? undefined
	: z.object({
			enabled: z.boolean().default(true),
			baseUrl: z.string().default(""),
			apiKeyEnv: z.string().default(""),
			apiKey: z.string().default(""),
			accessToken: z.string().default(""),
			userId: z.string().default(""),
			refreshMinutes: z.number().default(5)
		});

export const ROUTE = "/api/newapi-balance";

/** Optional per-install config file, read at mount time. */
export const LOCAL_FILE = join(homedir(), ".dsh", "newapi-balance.json");

/** Fallback conversion, matching New API's own convention. */
const DEFAULT_QUOTA_PER_UNIT = 500_000;

/**
 * Read the optional local config file. It exists so an install can be pointed
 * at a relay without editing any composition: whatever it sets wins over the
 * loader config, and a missing or malformed file is simply ignored.
 */
export function localConfig(file = LOCAL_FILE) {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed;
	} catch {
		return {};
	}
}

/** Merge loader config with the local file, field by field; the file wins. */
export function resolveConfig(config, file = {}) {
	const pick = (key, fallback) => (file?.[key] ?? config?.[key] ?? fallback);
	return {
		enabled: (file?.enabled ?? config?.enabled) !== false,
		baseUrl: String(pick("baseUrl", "")),
		apiKeyEnv: String(pick("apiKeyEnv", "")),
		apiKey: String(pick("apiKey", "")),
		accessToken: String(pick("accessToken", "")),
		userId: String(pick("userId", "")),
		refreshMinutes: Number(pick("refreshMinutes", 5))
	};
}

/**
 * The `sk-` key to read usage with: the one pasted into the capsule wins over
 * the credential name, because pasting it right there is what people expect.
 */
export function keyOf(config) {
	const pasted = String(config?.apiKey ?? "").trim();
	if (pasted !== "") return pasted;
	return readCredential(config?.apiKeyEnv);
}

/** Strip a trailing slash and a trailing `/v1`, which relays often carry in the provider base URL. */
export function siteRoot(value) {
	const raw = String(value ?? "").trim().replace(/\/+$/, "");
	return raw.endsWith("/v1") ? raw.slice(0, -3) : raw;
}

/** Whether a socket address or Host header names this machine. */
export function isLoopback(value) {
	const raw = String(value ?? "").trim().toLowerCase();
	if (raw === "") return false;
	if (raw.startsWith("[")) return raw.startsWith("[::1]") || raw.startsWith("[::ffff:127.0.0.1]");
	if (raw.startsWith("::1")) return true;
	if (raw.startsWith("::ffff:127.0.0.1")) return true;
	const host = raw.split(":")[0];
	return host === "127.0.0.1" || host === "localhost";
}

/**
 * Read one credential reference out of the harness credential file.
 *
 * The file is the same one the credentials seam reads, and this plugin only
 * needs a name→value lookup; parsing the small `refs:` block keeps the plugin
 * free of a YAML dependency and cannot rewrite anything.
 */
export function readCredential(reference) {
	const wanted = String(reference ?? "").trim();
	if (wanted === "") return undefined;
	const fromEnv = process.env[wanted];
	if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
	const file = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), ".credentials.yaml");
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
	const pattern = new RegExp(`^\\s*${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+)$`, "m");
	const match = pattern.exec(text);
	if (match === null) return undefined;
	return match[1].trim().replace(/^["']|["']$/g, "");
}

/** CNY and USD are the only two currencies a New API site reports; keep the conversion explicit. */
export function money(quota, units) {
	const perUnit = Number(units.quotaPerUnit) > 0 ? Number(units.quotaPerUnit) : DEFAULT_QUOTA_PER_UNIT;
	const rate = Number(units.exchangeRate) > 0 ? Number(units.exchangeRate) : 1;
	const usd = Number(quota) / perUnit;
	return {
		usd: Math.round(usd * 10000) / 10000,
		cny: Math.round(usd * rate * 10000) / 10000,
		usdExchangeRate: rate,
		quotaPerUnit: perUnit
	};
}

async function getJson(url, headers, timeoutMs) {
	const response = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(timeoutMs)
	});
	const text = await response.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = undefined;
	}
	// Relays answer 429 with the wait they want (`Retry-After`), usually minutes:
	// polling through it only extends the block, so the caller backs off by it.
	const retryAfter = Number(response.headers.get("retry-after"));
	return {
		status: response.status,
		body,
		text: text.slice(0, 300),
		retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
	};
}

/** Site conversion factors, cached for the life of the mount. */
function statusReader(root, timeoutMs) {
	let units;
	let at = 0;
	return async () => {
		if (units !== undefined && Date.now() - at < 6 * 60 * 60 * 1000) return units;
		try {
			const { body } = await getJson(`${root}/api/status`, { accept: "application/json" }, timeoutMs);
			const data = body?.data ?? {};
			units = {
				quotaPerUnit: Number(data.quota_per_unit) || DEFAULT_QUOTA_PER_UNIT,
				exchangeRate: Number(data.price) || Number(data.usd_exchange_rate) || 1,
				siteName: typeof data.system_name === "string" ? data.system_name : undefined
			};
			at = Date.now();
		} catch {
			if (units === undefined) units = { quotaPerUnit: DEFAULT_QUOTA_PER_UNIT, exchangeRate: 1 };
		}
		return units;
	};
}

/**
 * Build one readout.
 *
 * Never throws for a relay problem: "no balance endpoint", "key rejected" and
 * "unreachable" are states of the readout, not failures of the harness.
 */
export async function buildReadout(config, unitsOf, fetchedAt = Date.now()) {
	if (!config.enabled) return { ok: false, enabled: false, reason: "disabled" };
	const root = siteRoot(config.baseUrl);
	if (root === "") return { ok: false, enabled: true, reason: "no-base-url" };
	const units = await unitsOf();
	const common = { enabled: true, site: root, siteName: units.siteName, fetchedAt };

	const accessToken = String(config.accessToken ?? "").trim();
	const userId = String(config.userId ?? "").trim();
	// The access token alone identifies the account (`/api/user/self` resolves the
	// user from the token); the numeric id is only needed by deployments that also
	// check `New-Api-User`, so it is an optional extra header.
	let accountProblem;
	if (accessToken !== "") {
		const headers = { accept: "application/json", authorization: `Bearer ${accessToken}` };
		if (userId !== "") headers["new-api-user"] = userId;
		let answer;
		try {
			answer = await getJson(`${root}/api/user/self`, headers, 8000);
		} catch (error) {
			return { ...common, ok: false, reason: "unreachable", detail: String(error?.message ?? error) };
		}
		const data = answer.body?.data;
		if (answer.status !== 200 || data === undefined || data === null) {
			accountProblem = {
				reason:
					answer.status === 429
						? "rate-limited"
						: answer.status === 401
							? "bad-access-token"
							: "account-unavailable",
				status: answer.status,
				retryAfterSeconds: answer.retryAfterSeconds
			};
		} else {
			const quota = Number(data.quota ?? 0);
			const used = Number(data.used_quota ?? 0);
			const name = [data.username, data.display_name].find((value) => typeof value === "string" && value !== "");
			return {
				...common,
				ok: true,
				source: "account",
				unlimited: data.unlimited_quota === true,
				remaining: money(quota, units),
				used: money(used, units),
				accountName: name,
				accountId: data.id
			};
		}
	}

	// Key-scoped usage: works with the sk- key the profile already carries. It is
	// also the fallback when the access token is rejected, so the capsule still
	// shows something useful instead of going blank.
	const key = keyOf(config);
	if (key === undefined) {
		if (accountProblem !== undefined) return { ...common, ok: false, ...accountProblem };
		return { ...common, ok: false, reason: "no-key" };
	}
	let answer;
	try {
		answer = await getJson(
			`${root}/api/usage/token/`,
			{ accept: "application/json", authorization: `Bearer ${key}` },
			8000
		);
	} catch (error) {
		return { ...common, ok: false, reason: "unreachable", detail: String(error?.message ?? error) };
	}
	const data = answer.body?.data;
	if (answer.status !== 200 || !data) {
		return {
			...common,
			ok: false,
			reason:
				answer.status === 429
					? "rate-limited"
					: answer.status === 401
						? "bad-key"
						: "usage-unavailable",
			status: answer.status,
			retryAfterSeconds: answer.retryAfterSeconds
		};
	}
	const granted = Number(data.total_granted ?? 0);
	const used = Number(data.total_used ?? 0);
	const available = Number(data.total_available ?? 0);
	return {
		...common,
		ok: true,
		source: "key",
		unlimited: data.unlimited_quota === true,
		keyName: typeof data.name === "string" ? data.name : undefined,
		remaining: data.unlimited_quota === true ? null : money(available, units),
		used: money(used, units),
		granted: money(granted, units),
		...(accountProblem === undefined ? {} : { accountError: accountProblem.reason })
	};
}

export function apply(ctx, config) {
	// `~/.dsh/newapi-balance.json` (if present) wins over the loader config, and
	// it is re-read per request, so editing that file — or the panel in the
	// capsule, which writes it — takes effect on the next poll.
	if (!resolveConfig(config, localConfig()).enabled) return;

	// One units reader per site root: switching `baseUrl` picks up a fresh
	// reader instead of reusing the old site's conversion.
	const readers = new Map();
	const readerFor = (root) => {
		let reader = readers.get(root);
		if (reader === undefined) {
			reader = statusReader(root, 8000);
			readers.set(root, reader);
		}
		return reader;
	};
	const log = ctx.logger ?? console;

	// Relays rate-limit `/api/usage/token/` hard (429 within a few calls), and the
	// capsule polls on a timer, so one readout is shared: cache for a few seconds,
	// then back off for minutes after a 429 and keep serving the last good answer.
	const CACHE_MS = 12_000;
	const BACKOFF_MS = 3 * 60_000;
	const STALE_MS = 30 * 60_000;
	const state = { at: 0, result: undefined, good: undefined, goodAt: 0, backoffUntil: 0 };

	const sendJson = (res, status, value) => {
		const body = JSON.stringify(value);
		res.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-cache"
		});
		res.end(body);
	};

	const envelope = (result, current, extra) => ({
		...result,
		refreshMinutes: current.refreshMinutes,
		config: publicConfig(current),
		...extra
	});

	const readout = async (force = false) => {
		const current = resolveConfig(config, localConfig());
		const now = Date.now();
		if (!current.enabled) return envelope({ ok: false, enabled: false, reason: "disabled" }, current);
		if (!force && state.result !== undefined && now - state.at < CACHE_MS) return state.result;
		// A manual "refresh" may skip the short cache, never the rate-limit backoff:
		// retrying into a 429 is what makes the block longer.
		if (now < state.backoffUntil) {
			if (state.good !== undefined && now - state.goodAt < STALE_MS) {
				return envelope(state.good, current, {
					ok: true,
					stale: true,
					staleReason: "rate-limited",
					ageMs: now - state.goodAt
				});
			}
			return envelope({ ok: false, enabled: true, reason: "rate-limited", retryAfterSeconds: Math.round((state.backoffUntil - now) / 1000) }, current);
		}
		const result = await buildReadout(current, readerFor(siteRoot(current.baseUrl)), now);
		let answer = envelope(result, current);
		if (result.ok) {
			state.good = result;
			state.goodAt = now;
			state.backoffUntil = 0;
		} else if (result.status === 429) {
			// The relay tells us how long to wait; honour it instead of retrying into
			// a longer block, and keep showing the last good number meanwhile.
			const waitMs = Number.isFinite(result.retryAfterSeconds)
				? Math.min(30 * 60_000, Math.max(30_000, result.retryAfterSeconds * 1000))
				: BACKOFF_MS;
			state.backoffUntil = now + waitMs;
			if (state.good !== undefined && now - state.goodAt < STALE_MS) {
				answer = envelope(state.good, current, {
					ok: true,
					stale: true,
					staleReason: "rate-limited",
					ageMs: now - state.goodAt
				});
			}
		}
		state.result = answer;
		state.at = now;
		return answer;
	};

	const mount = (scoped) => {
		const server = scoped.webServer;
		if (server === undefined || typeof server.register !== "function") {
			log.warn?.("newapi-balance: no webServer in this composition; the readout stays unavailable");
			return;
		}
		const guard = (req) =>
			req?.method === undefined ||
			(!isLoopback(req?.socket?.remoteAddress) || !isLoopback(req?.headers?.host) ? "forbidden" : undefined);

		ctx.effect(() => {
			const offRead = server.register({
				kind: "exact",
				path: ROUTE,
				handler: async (req, res) => {
					const denied = guard(req);
					if (denied !== undefined) return sendJson(res, 403, { ok: false, reason: denied });
					if (req?.method !== "GET") return sendJson(res, 405, { ok: false, reason: "method-not-allowed" });
					try {
						const force = /[?&]force=1\b/.test(String(req?.url ?? ""));
						sendJson(res, 200, await readout(force));
					} catch (error) {
						log.warn?.("newapi-balance: readout failed: %s", error?.message ?? error);
						sendJson(res, 500, { ok: false, reason: "internal" });
					}
				}
			});

			const offWrite = server.register({
				kind: "exact",
				path: `${ROUTE}/config`,
				handler: async (req, res) => {
					const denied = guard(req);
					if (denied !== undefined) return sendJson(res, 403, { ok: false, reason: denied });
					if (req?.method !== "POST") return sendJson(res, 405, { ok: false, reason: "method-not-allowed" });
					let patch;
					try {
						patch = JSON.parse(await readBody(req));
					} catch {
						return sendJson(res, 400, { ok: false, reason: "bad-body" });
					}
					const clean = sanitizeConfig(patch);
					if (clean.error !== undefined) return sendJson(res, 400, { ok: false, reason: clean.error });
					try {
						saveLocalConfig(clean.value);
					} catch (error) {
						log.warn?.("newapi-balance: saving config failed: %s", error?.message ?? error);
						return sendJson(res, 500, { ok: false, reason: "save-failed" });
					}
					// A fresh site means nothing cached about the old one is useful.
					state.result = undefined;
					state.at = 0;
					state.backoffUntil = 0;
					state.good = undefined;
					sendJson(res, 200, { ok: true, saved: true, readout: await readout(true) });
				}
			});

			const offReveal = server.register({
				kind: "exact",
				path: `${ROUTE}/reveal`,
				handler: async (req, res) => {
					const denied = guard(req);
					if (denied !== undefined) return sendJson(res, 403, { ok: false, reason: denied });
					if (req?.method !== "GET") return sendJson(res, 405, { ok: false, reason: "method-not-allowed" });
					// The eye button in the panel shows what is actually stored, so the
					// loopback guard above is the only protection these values get.
					sendJson(res, 200, { ok: true, ...revealConfig(resolveConfig(config, localConfig())) });
				}
			});

			return () => {
				if (typeof offRead === "function") offRead();
				if (typeof offWrite === "function") offWrite();
				if (typeof offReveal === "function") offReveal();
			};
		}, "newapi-balance routes");
		log.info?.("newapi-balance: serving %s", ROUTE);
	};

	// `webServer` mounts after this plugin on a real install, so it is waited
	// for rather than sampled — a sampled `ctx.get("webServer")` here answers
	// undefined and the route silently never exists.
	if (typeof ctx.inject === "function") ctx.inject(["webServer"], mount);
	else if (typeof ctx.get === "function") mount(ctx);
}

/** What the panel may know about the current config: secrets never travel back. */
export function publicConfig(resolved) {
	const file = localConfig();
	const key = keyOf(resolved);
	return {
		enabled: resolved.enabled,
		baseUrl: resolved.baseUrl,
		apiKeyEnv: resolved.apiKeyEnv,
		userId: resolved.userId,
		refreshMinutes: resolved.refreshMinutes,
		hasAccessToken: String(resolved.accessToken ?? "").trim() !== "",
		hasApiKey: String(resolved.apiKey ?? "").trim() !== "",
		keyPresent: key !== undefined,
		fileFields: Object.keys(file)
	};
}

/**
 * The stored secrets, for the panel's eye toggle. Only reachable from loopback
 * and only on an explicit request, so the panel can show what it saved without
 * the readout route leaking credentials on every poll.
 */
export function revealConfig(resolved) {
	const file = localConfig();
	const pasted = String(resolved.apiKey ?? "").trim();
	const fromName = readCredential(resolved.apiKeyEnv);
	return {
		apiKey: pasted !== "" ? pasted : (fromName ?? ""),
		apiKeySource: pasted !== "" ? "local" : fromName === undefined ? "none" : "reference",
		accessToken: String(resolved.accessToken ?? "").trim(),
		userId: String(resolved.userId ?? "").trim(),
		baseUrl: String(resolved.baseUrl ?? "").trim(),
		storedIn: Object.keys(file)
	};
}

/** Merge a patch into the local config file; empty strings clear a field. */
export function saveLocalConfig(patch, file = LOCAL_FILE) {
	const next = { ...localConfig(file) };
	for (const [key, value] of Object.entries(patch ?? {})) {
		if (value === undefined) continue;
		if (value === null || value === "") delete next[key];
		else next[key] = value;
	}
	mkdirSync(dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	renameSync(temp, file);
	return next;
}

/** Accept only the fields the panel edits; `{ error }` means "reject as 400". */
export function sanitizeConfig(patch) {
	if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return { error: "bad-body" };
	const value = {};
	if (patch.baseUrl !== undefined) {
		const raw = String(patch.baseUrl).trim();
		if (raw !== "" && !/^https?:\/\/[^\s]+$/i.test(raw)) return { error: "bad-base-url" };
		value.baseUrl = raw.replace(/\/+$/, "");
	}
	for (const key of ["apiKeyEnv", "apiKey", "accessToken", "userId"]) {
		if (patch[key] === undefined) continue;
		const raw = String(patch[key]).trim();
		if (/\s/.test(raw)) return { error: `bad-${key}` };
		value[key] = raw;
	}
	if (patch.refreshMinutes !== undefined) {
		const minutes = Number(patch.refreshMinutes);
		if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) return { error: "bad-refresh-minutes" };
		value.refreshMinutes = minutes;
	}
	if (patch.enabled !== undefined) value.enabled = patch.enabled !== false;
	return { value };
}

/** Read a small JSON request body. */
function readBody(req, limit = 16 * 1024) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error("payload too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
