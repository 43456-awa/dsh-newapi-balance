/**
 * Client half: a floating balance capsule on the composer card.
 *
 * Collapsed, it is a single status dot tucked into the top-right corner of the
 * input card (`conversation.input.overlay` renders inside the card's overlay
 * anchor, so `position: absolute` lands on the card itself). Clicking the dot
 * opens a small frosted capsule with the relay's remaining balance, what has
 * been used, and the account or key it was read from.
 *
 * The capsule also carries its own settings (`⚙`): the site address, the
 * credential name, and the optional access token / user id that switch the
 * readout from "this key's usage" to "this account's balance". Saving writes
 * `~/.dsh/newapi-balance.json` through the host route and re-reads immediately,
 * so a fresh install is two fields away from working — no composition editing,
 * no app restart.
 *
 * Written as a plain bundle (no build step) so the shipped file is the source:
 * `window.__ModuleLoader__.load` hands us `require`, and everything below runs
 * in the page's module graph.
 *
 * @module dsh-newapi-balance/client
 */

window.__ModuleLoader__.load({
	id: "dsh-newapi-balance",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;

		let React;
		try {
			React = require("react");
		} catch (error) {
			console.error("[newapi-balance] react is not in the graph:", error);
			return module.exports;
		}

		const h = React.createElement;
		const NS = "dsh-newapi-balance";
		const ROUTE = "/api/newapi-balance";
		const CONFIG_ROUTE = `${ROUTE}/config`;
		/** Fallback cadence; the host's `refreshMinutes` wins when it sends one. */
		const POLL_MS = 60_000;
		/** The capsule's fixed width; the placement math keeps it inside the viewport. */
		const PANEL_W = 296;
		const CSS_ID = `${NS}/capsule.css`;

		/* ------------------------------------------------------------------ */
		/* Styles                                                              */
		/* ------------------------------------------------------------------ */

		const CSS = `
.nb-root{position:absolute;top:-16px;right:8px;z-index:20;display:flex;justify-content:flex-end;pointer-events:none}
.nb-trigger{pointer-events:auto;box-sizing:border-box;width:26px;height:26px;padding:0;border:0;border-radius:999px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff));box-shadow:0 1px 4px rgba(0,0,0,.07);display:grid;place-items:center;cursor:pointer;opacity:.75;transition:opacity .18s var(--ds-ease-in-out,ease),box-shadow .18s var(--ds-ease-in-out,ease),background-color .18s var(--ds-ease-in-out,ease)}
.nb-trigger:hover,.nb-trigger[aria-expanded="true"]{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.nb-trigger:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#3b82f6));outline-offset:2px}
.nb-dot{width:7px;height:7px;border-radius:50%;background:var(--nb-tone,var(--dsw-alias-label-tertiary,#9ca3af));box-shadow:0 0 0 2px color-mix(in srgb,var(--nb-tone,#9ca3af) 24%,transparent);transition:background-color .25s var(--ds-ease-in-out,ease)}
.nb-ring{display:block;overflow:visible}
.nb-ring-track{stroke:var(--dsw-alias-border-l2,#d7dae0);transition:stroke .35s var(--ds-ease-in-out,ease)}
.nb-ring-arc{transition:stroke-dashoffset .45s var(--ds-ease-out,ease),stroke .35s var(--ds-ease-in-out,ease)}
.nb-ring-text{font-family:inherit;font-size:8px;font-weight:650;letter-spacing:-.3px;fill:var(--dsw-alias-label-primary,#20232a);user-select:none;font-variant-numeric:tabular-nums}
.nb-dot-live{animation:nb-pulse 1.6s ease-in-out infinite}
@keyframes nb-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.nb-panel{pointer-events:auto;position:fixed;z-index:1200;width:296px;box-sizing:border-box;border-radius:16px;padding:10px 12px 9px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#ffffff) 88%,transparent);backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));box-shadow:var(--dsw-shadow-lv2,0 14px 38px rgba(15,23,42,.18));color:var(--dsw-alias-label-primary,#111827);font-size:12px;line-height:1.45;transform-origin:bottom right;animation:nb-pop .18s var(--ds-ease-out,ease-out)}
@keyframes nb-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
.nb-head{display:flex;align-items:center;gap:6px;min-width:0;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.nb-panel-placed{transform-origin:top left;animation:none}
.nb-head:active{cursor:grabbing}
.nb-head .nb-site,.nb-head .nb-src{cursor:inherit}
.nb-head .nb-dot{flex:none;--nb-tone:var(--nb-state,var(--dsw-alias-label-tertiary,#9ca3af))}
.nb-site{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
.nb-src{flex:none;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary,#6b7280);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:999px;padding:0 6px;white-space:nowrap}
.nb-spacer{flex:1 1 auto;min-width:0}
.nb-icon{flex:none;display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#9ca3af);cursor:pointer;font-size:12px;line-height:1;transition:color .15s var(--ds-ease-in-out,ease),background-color .15s var(--ds-ease-in-out,ease)}
.nb-icon:hover,.nb-icon[aria-pressed="true"]{color:var(--dsw-alias-label-primary,#111827);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.nb-icon-busy{animation:nb-spin .8s linear infinite}
@keyframes nb-spin{to{transform:rotate(360deg)}}
.nb-hero{display:flex;align-items:baseline;gap:7px;margin:9px 0 1px;min-width:0}
.nb-val{font-size:23px;font-weight:650;letter-spacing:-.015em;font-variant-numeric:tabular-nums;line-height:1.15;white-space:nowrap}
.nb-val-sm{font-size:18px}
.nb-cur{font-size:14px;font-weight:600;margin-right:1px;color:var(--dsw-alias-label-secondary,#6b7280);opacity:.9}
.nb-badge{flex:none;font-size:10px;line-height:15px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 14%,transparent);color:var(--dsw-alias-brand-primary,#3b82f6);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 30%,transparent)}
.nb-sub{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nb-badge-alert{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 13%,transparent);color:var(--dsw-alias-state-error-primary,#dc2626);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 30%,transparent)}
.nb-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);white-space:nowrap}
.nb-bar{margin:8px 0 1px;height:4px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary,#6b7280) 20%,transparent);overflow:hidden}
.nb-bar > i{display:block;height:100%;border-radius:inherit;background:var(--nb-state,var(--dsw-alias-state-success-primary,#16a34a));transition:width .45s var(--ds-ease-out,ease)}
.nb-err{margin:9px 0 2px;color:var(--nb-state,var(--dsw-alias-state-warn-primary,#d97706));font-size:13px;font-weight:650;letter-spacing:-.01em}
.nb-note{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nb-foot{display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:10.5px;line-height:1.4;min-width:0}
.nb-foot-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.nb-link{color:var(--dsw-alias-brand-primary,#3b82f6);cursor:pointer;text-decoration:none;flex:none;background:none;border:0;padding:0;font:inherit}
.nb-link:hover{text-decoration:underline}
.nb-stale{color:var(--dsw-alias-state-warn-primary,#d97706)}
.nb-form{display:flex;flex-direction:column;gap:7px;margin-top:9px}
.nb-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.nb-field > span{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#9ca3af);display:flex;align-items:center;gap:4px}
.nb-field > .nb-field-head{justify-content:flex-start}
.nb-eye{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:auto;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#9ca3af);cursor:pointer;line-height:0}
.nb-eye:hover{color:var(--dsw-alias-label-primary,#111827);background:color-mix(in srgb,var(--dsw-alias-label-primary,#111827) 8%,transparent)}
.nb-field > input{box-sizing:border-box;width:100%;height:26px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 92%,transparent);color:var(--dsw-alias-label-primary,#111827);font:inherit;font-size:11.5px;outline:none;transition:border-color .15s var(--ds-ease-in-out,ease),box-shadow .15s var(--ds-ease-in-out,ease)}
.nb-field > input:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 18%,transparent)}
.nb-field > input::placeholder{color:var(--dsw-alias-label-tertiary,#9ca3af)}
.nb-row{display:flex;gap:7px}
.nb-row > .nb-field{flex:1 1 0}
.nb-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#9ca3af);line-height:1.35}
.nb-ok{color:var(--dsw-alias-state-success-primary,#16a34a)}
.nb-warn-text{color:var(--dsw-alias-state-warn-primary,#d97706)}
.nb-seg{display:flex;gap:4px;flex:1 1 0}
.nb-seg-btn{flex:1 1 0;height:26px;padding:0 6px;border-radius:8px;cursor:pointer;font:inherit;font-size:11.5px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);transition:border-color .15s var(--ds-ease-in-out,ease),color .15s var(--ds-ease-in-out,ease)}
.nb-seg-btn:hover{color:var(--dsw-alias-label-primary,#111827)}
.nb-seg-btn.is-on{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 12%,transparent);color:var(--dsw-alias-brand-primary,#3b82f6);font-weight:600}
.nb-actions{display:flex;align-items:center;gap:6px;margin-top:3px}
.nb-btn{font:inherit;font-size:11px;line-height:20px;height:23px;padding:0 10px;border-radius:7px;border:1px solid transparent;cursor:pointer;white-space:nowrap}
.nb-btn-primary{background:var(--dsw-alias-brand-primary,#3b82f6);color:#fff}
.nb-btn-primary:disabled{opacity:.55;cursor:default}
.nb-btn-ghost{background:transparent;border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.12));color:var(--dsw-alias-label-secondary,#6b7280)}
.nb-btn-ghost:hover{color:var(--dsw-alias-label-primary,#111827)}
.nb-cta{font:inherit;font-size:11px;line-height:20px;height:22px;padding:0 8px;border-radius:7px;cursor:pointer;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 24%,transparent);color:var(--dsw-alias-brand-primary,#3b82f6)}
.nb-cta:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 18%,transparent)}
`;

		function injectStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) !== null) return;
			const style = document.createElement("style");
			style.dataset.plugin = NS;
			style.dataset.pluginCss = CSS_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		/* ------------------------------------------------------------------ */
		/* Formatting                                                          */
		/* ------------------------------------------------------------------ */

		/** Two decimals below 100 (where cents matter), one above it. */
		function amount(value) {
			const n = Number(value);
			if (!Number.isFinite(n)) return undefined;
			const text = Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2);
			// 1308.0 reads like a typo; whole amounts lose the tail once the site
			// rounds them anyway.
			return text.endsWith(".0") ? text.slice(0, -2) : text;
		}

		/** Which money the capsule reports in: the site's native USD, or CNY. */
		function normalizeCurrency(value) {
			const raw = String(value ?? "").trim().toLowerCase();
			return raw === "cny" ? "cny" : "usd";
		}

		/** The site's own money, in yuan; the USD figure only rides along as a hint. */
		function cny(money) {
			if (!money || typeof money.cny !== "number" || !Number.isFinite(money.cny)) return undefined;
			return amount(money.cny);
		}

		function usd(money) {
			if (!money || typeof money.usd !== "number" || !Number.isFinite(money.usd)) return undefined;
			const text = amount(money.usd);
			return text === undefined ? undefined : `$${text}`;
		}

		function hostOf(site) {
			const raw = String(site ?? "").trim();
			if (raw === "") return "";
			try {
				return new URL(raw).host;
			} catch {
				return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
			}
		}

		function clockOf(at) {
			const stamp = Number(at);
			if (!Number.isFinite(stamp)) return "";
			try {
				return new Date(stamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
			} catch {
				return "";
			}
		}

		const REASONS = {
			"no-base-url": "还没填站点地址",
			"no-key": "找不到密钥",
			"bad-key": "密钥被拒",
			"bad-access-token": "访问令牌被拒",
			"account-unavailable": "账号信息读不到",
			"usage-unavailable": "该站不支持用量查询",
			"rate-limited": "站点限流了，稍后再试",
			unreachable: "连不上站点",
			disabled: "已关闭",
			"method-not-allowed": "请求方式不对",
			forbidden: "只允许本机访问",
			internal: "读取失败"
		};

		/** Which reasons are "configure me" rather than "something broke". */
		const CALM = new Set(["no-base-url", "no-key", "disabled"]);

		const SAVE_ERRORS = {
			"bad-base-url": "地址要写成 https://开头的完整地址",
			"bad-apiKeyEnv": "密钥名不能有空格",
			"bad-accessToken": "访问令牌不能有空格",
			"bad-userId": "用户 ID 不能有空格",
			"bad-currency": "货币只能是美元或人民币",
			"bad-refresh-minutes": "间隔要填 0 ~ 1440 的数字",
			"bad-body": "提交内容不合法",
			"save-failed": "写入配置失败"
		};

		/* ------------------------------------------------------------------ */
		/* State                                                               */
		/* ------------------------------------------------------------------ */

		/**
		 * Group a readout into what the dot and the capsule need: a colour, a
		 * one-line summary, and the numbers (all optional).
		 */
		function describe(state) {
			if (state === undefined) {
				return { tone: "var(--dsw-alias-label-tertiary,#9ca3af)", busy: true, headline: "…", sub: "读取中", err: false };
			}
			if (state.error !== undefined) {
				return { tone: "var(--dsw-alias-state-error-primary,#dc2626)", err: true, headline: "读取失败", sub: state.error };
			}
			const config = state.config ?? {};
			const unconfigured = config.baseUrl === undefined || config.baseUrl === "";

			if (!state.ok) {
				const zh = REASONS[state.reason] ?? String(state.reason ?? "未知原因");
				const calm = CALM.has(state.reason);
				const wait = Number(state.retryAfterSeconds);
				const sub =
					state.reason === "rate-limited" && Number.isFinite(wait) && wait > 0
						? `站点限流了，约 ${Math.max(1, Math.ceil(wait / 60))} 分钟后再试`
						: zh;
				return {
					tone: calm ? "var(--dsw-alias-label-tertiary,#9ca3af)" : "var(--dsw-alias-state-warn-primary,#d97706)",
					err: true,
					calm,
					unconfigured,
					headline: "读不到余量",
					sub,
					reason: state.reason
				};
			}

			// Amounts stay in the site's native USD unless the panel was told to
			// convert; the other figure rides along as a small "≈" hint.
			const currency = normalizeCurrency(state.currency ?? state.config?.currency);
			const symbol = currency === "cny" ? "¥" : "$";
			const hintSymbol = currency === "cny" ? "$" : "¥";
			const measure = (money) => {
				const raw = money?.[currency];
				return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
			};
			const hintOf = (money) => {
				const raw = money?.[currency === "cny" ? "usd" : "cny"];
				return typeof raw === "number" && Number.isFinite(raw) ? `≈ ${hintSymbol}${amount(raw)}` : undefined;
			};
			const remaining = amount(measure(state.remaining));
			const used = amount(measure(state.used));
			const granted = amount(measure(state.granted));
			const unlimited = state.unlimited === true;
			const source = state.source === "account" ? "账号" : "密钥";

			let total;
			if (state.source === "account" && remaining !== undefined && used !== undefined) {
				total = Number(remaining) + Number(used);
			} else if (granted !== undefined && Number(granted) > 0) {
				total = Number(granted);
			}

			const ratio =
				!unlimited && total !== undefined && total > 0 && used !== undefined
					? Math.min(1, Math.max(0, Number(used) / total))
					: undefined;

			const exhausted = !unlimited && remaining !== undefined && Number(remaining) <= 0;

			// The collapsed trigger is a ring: how much is left as a percentage, and a
			// colour that walks from green at full towards red as the money runs out.
			const left = ratio === undefined ? undefined : Math.max(0, Math.min(1, 1 - ratio));
			const percent = left === undefined ? undefined : Math.round(left * 100);
			const ringTone =
				left === undefined ? undefined : `hsl(${Math.round(142 * Math.pow(left, 0.85))} 70% 42%)`;

			return {
				tone: exhausted
					? "var(--dsw-alias-state-error-primary,#dc2626)"
					: unlimited
						? "var(--dsw-alias-brand-primary,#3b82f6)"
						: ratio !== undefined && ratio >= 0.9
							? "var(--dsw-alias-state-warn-primary,#d97706)"
							: "var(--dsw-alias-state-success-primary,#16a34a)",
				ok: true,
				unlimited,
				exhausted,
				source,
				currency,
				symbol,
				remaining,
				hint: hintOf(state.remaining),
				used,
				total: total === undefined ? undefined : amount(total),
				ratio,
				left,
				percent,
				ringTone,
				stale: state.stale === true,
				staleReason: state.staleReason,
				who:
					state.source === "account"
						? state.accountName
						: state.keyName !== undefined
							? `密钥 ${state.keyName}`
							: "密钥用量"
			};
		}

		/** The dot's hover text: the whole readout in one line, for people who never open it. */
		function tip(info, state) {
			if (state === undefined) return "中转站余量 · 读取中";
			if (info.err) return `中转站余量 · ${info.sub}`;
			const bits = [state.siteName || hostOf(state.site) || "中转站"];
			if (info.unlimited) bits.push("额度不限");
			else if (info.remaining !== undefined)
				bits.push(
					info.percent === undefined
						? `剩余 ${info.symbol}${info.remaining}`
						: `剩余 ${info.symbol}${info.remaining}（${info.percent}%）`
				);
			if (info.used !== undefined) bits.push(`已用 ${info.symbol}${info.used}`);
			return bits.join(" · ");
		}

		/* ------------------------------------------------------------------ */
		/* Components                                                          */
		/* ------------------------------------------------------------------ */

		/** Poll interval from the host, clamped to something a relay tolerates. */
		function intervalOf(state) {
			const minutes = Number(state?.refreshMinutes);
			if (!Number.isFinite(minutes) || minutes < 0) return POLL_MS;
			if (minutes === 0) return 0;
			return Math.max(60_000, Math.round(minutes * 60_000));
		}

		function useReadout() {
			const [state, setState] = React.useState(undefined);
			const [busy, setBusy] = React.useState(false);

			const read = React.useCallback(async (force = false) => {
				setBusy(true);
				try {
					const response = await fetch(`${ROUTE}${force ? "?force=1" : ""}`, { headers: { accept: "application/json" } });
					const body = await response.json();
					setState({ ...body, updatedAt: Date.now() });
				} catch (error) {
					setState((previous) => ({
						...(previous ?? {}),
						ok: false,
						reason: "unreachable",
						error: String(error?.message ?? error)
					}));
				} finally {
					setBusy(false);
				}
			}, []);

			const value = state;
			React.useEffect(() => {
				let disposed = false;
				const tick = () => {
					if (disposed) return;
					if (document !== undefined && document.visibilityState === "hidden") return;
					read(false);
				};
				tick();
				const interval = intervalOf(value);
				if (interval === 0) {
					return () => {
						disposed = true;
					};
				}
				const timer = setInterval(tick, interval);
				return () => {
					disposed = true;
					clearInterval(timer);
				};
				// Re-arm when the host changes a poll timing or the site.
			}, [read, value?.refreshMinutes, value?.site]);

			return { state, busy, refresh: read };
		}

		function ConfigForm(props) {
			const { config, onSaved, onCancel } = props;
			const [draft, setDraft] = React.useState(() => ({
				baseUrl: config?.baseUrl ?? "",
				apiKey: "",
				accessToken: "",
				userId: config?.userId ?? "",
				refreshMinutes: String(config?.refreshMinutes ?? 5),
				currency: config?.currency === "cny" ? "cny" : "usd"
			}));
			const [saving, setSaving] = React.useState(false);
			const [problem, setProblem] = React.useState(undefined);
			const [revealed, setRevealed] = React.useState(false);
			const [legacy, setLegacy] = React.useState(false);
			const [show, setShow] = React.useState({ apiKey: false, accessToken: false });

			// The form edits the values the host really holds, so it asks for them once
			// when it opens: both fields arrive pre-filled (masked), the eye shows what
			// is stored, and typing over a field replaces it. A host without the reveal
			// route keeps the old "blank means keep" behaviour.
			React.useEffect(() => {
				let disposed = false;
				const load = async () => {
					try {
						const response = await fetch(`${ROUTE}/reveal`, { headers: { accept: "application/json" } });
						const body = await response.json();
						if (disposed) return;
						if (body?.ok !== true) {
							// 401 text from an older host's catch-all instead of our route.
							setLegacy(true);
							return;
						}
						setRevealed(true);
						setDraft((was) => ({
							...was,
							apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
							accessToken: typeof body.accessToken === "string" ? body.accessToken : "",
							userId: was.userId !== "" ? was.userId : (typeof body.userId === "string" ? body.userId : "")
						}));
					} catch {
						/* no reveal route: keep blanks */
						if (!disposed) setLegacy(true);
					}
				};
				load();
				return () => {
					disposed = true;
				};
			}, []);

			const change = (key) => (event) => setDraft((was) => ({ ...was, [key]: event.target.value }));

			const submit = async (event) => {
				event.preventDefault();
				if (saving) return;
				setSaving(true);
				setProblem(undefined);
				const patch = {
					baseUrl: draft.baseUrl.trim(),
					userId: draft.userId.trim(),
					refreshMinutes: draft.refreshMinutes.trim() === "" ? 5 : Number(draft.refreshMinutes.trim()),
					currency: draft.currency
				};
				// Revealed values are authoritative: clearing a field clears it on the
				// host. Without the reveal route, only non-empty edits are sent.
				for (const key of ["apiKey", "accessToken"]) {
					const value = draft[key].trim();
					if (revealed || value !== "") patch[key] = value;
				}
				try {
					const response = await fetch(CONFIG_ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json", accept: "application/json" },
						body: JSON.stringify(patch)
					});
					const body = await response.json();
					if (!response.ok || body.ok !== true) {
						setProblem(SAVE_ERRORS[body?.reason] ?? `保存失败（${body?.reason ?? response.status}）`);
						return;
					}
					onSaved(body.readout);
				} catch (error) {
					setProblem(`连不上 harness：${String(error?.message ?? error)}`);
				} finally {
					setSaving(false);
				}
			};

			const field = (label, key, placeholder, extra) =>
				h(
					"div",
					{ className: "nb-field" },
					h("span", null, label),
					h("input", {
						value: draft[key],
						placeholder,
						onChange: change(key),
						spellCheck: false,
						autoComplete: "off",
						...extra
					})
				);

			// Secrets get the same box plus an eye that flips the mask.
			const eyePath = (visible) =>
				h(
					"svg",
					{
						viewBox: "0 0 16 16",
						width: 12,
						height: 12,
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 1.4,
						strokeLinecap: "round",
						strokeLinejoin: "round"
					},
					h("path", { d: "M1.6 8S4 3.9 8 3.9 14.4 8 14.4 8 12 12.1 8 12.1 1.6 8 1.6 8Z" }),
					h("circle", { cx: 8, cy: 8, r: 2.1 }),
					visible ? h("path", { d: "M2.7 2.7 13.3 13.3" }) : null
				);

			const secretField = (label, key, placeholder) =>
				h(
					"div",
					{ className: "nb-field" },
					h(
						"span",
						{ className: "nb-field-head" },
						h("span", null, label),
						h(
							"button",
							{
								type: "button",
								className: "nb-eye",
								title: show[key] ? "隐藏" : "显示",
								"aria-label": show[key] ? "隐藏" : "显示",
								onClick: () => setShow((was) => ({ ...was, [key]: !was[key] }))
							},
							eyePath(show[key] === true)
						)
					),
					h("input", {
						value: draft[key],
						placeholder,
						onChange: change(key),
						type: show[key] === true ? "text" : "password",
						spellCheck: false,
						autoComplete: "off",
						autoCapitalize: "off"
					})
				);

			// Two-state choice (money unit): one row of pill buttons, no dropdown.
			const segmented = (label, key, options) =>
				h(
					"div",
					{ className: "nb-field" },
					h("span", null, label),
					h(
						"div",
						{ className: "nb-seg" },
						options.map((option) =>
							h(
								"button",
								{
									key: option.value,
									type: "button",
									className: `nb-seg-btn${draft[key] === option.value ? " is-on" : ""}`,
									onClick: () => setDraft((was) => ({ ...was, [key]: option.value }))
								},
								option.label
							)
						)
					)
				);

			const keyState =
				config?.keyPresent === true
					? h("span", { className: "nb-ok" }, "✓ 已存这把密钥")
					: h("span", { className: "nb-warn-text" }, "还没有密钥：把站点的 sk- 密钥黏到上面");

			return h(
				"form",
				{ className: "nb-form", onSubmit: submit },
				field("站点地址", "baseUrl", "https://newapi.example.com"),
				secretField("密钥（sk-…，直接黏在这里）", "apiKey", "sk-xxxxxxxx…"),
				h("div", { className: "nb-hint" }, keyState),
				h(
					"div",
					{ className: "nb-row" },
					field("用户 ID（可选）", "userId", "114514"),
					field("间隔分钟", "refreshMinutes", "5", { inputMode: "numeric" })
				),
				segmented("显示货币", "currency", [
					{ value: "usd", label: "美元（不换算）" },
					{ value: "cny", label: "人民币（按站点汇率）" }
				]),
				secretField("访问令牌（可选，填了才能看账户余额）", "accessToken", "在站点安全设置里生成"),
				legacy === true
					? h("div", { className: "nb-hint" }, "当前运行的 host 还是旧版本，密钥要重启窗口后才能保存")
					: null,
				problem === undefined ? null : h("div", { className: "nb-warn-text", style: { fontSize: 11 } }, problem),
				h(
					"div",
					{ className: "nb-actions" },
					h("button", { type: "submit", className: "nb-btn nb-btn-primary", disabled: saving }, saving ? "保存中…" : "保存"),
					h("button", { type: "button", className: "nb-btn nb-btn-ghost", onClick: onCancel }, "取消"),
					h("span", { className: "nb-spacer" }),
					h("span", { className: "nb-hint" }, "存到 ~/.dsh/newapi-balance.json")
				)
			);
		}

		function Hero(info, actions) {
			if (info.err) {
				return h(
					"div",
					null,
					h("div", { className: "nb-err" }, info.headline),
					h("div", { className: "nb-note" }, info.sub),
					info.calm === true
						? h(
								"div",
								{ style: { marginTop: 6 } },
								h("button", { type: "button", className: "nb-cta", onClick: actions.onConfigure }, "去填配置")
							)
						: null
				);
			}
			if (info.remaining !== undefined) {
				const usedPart = info.used !== undefined ? `已用 ${info.symbol}${info.used}` : "";
				const totalPart = info.total !== undefined ? `总额 ${info.symbol}${info.total}` : "";
				const sub = [usedPart, totalPart].filter(Boolean).join(" · ");
				return h(
					"div",
					null,
					h(
						"div",
						{ className: "nb-hero" },
						h("span", { className: "nb-label" }, "剩余"),
						h("span", { className: "nb-val" }, h("span", { className: "nb-cur" }, info.symbol), info.remaining),
						info.exhausted ? h("span", { className: "nb-badge nb-badge-alert" }, "已用尽") : null,
						h("span", { className: "nb-spacer" }),
						info.hint !== undefined ? h("span", { className: "nb-sub" }, info.hint) : null
					),
					sub === "" ? null : h("div", { className: "nb-sub" }, sub),
					info.ratio !== undefined
						? h("div", { className: "nb-bar", role: "presentation" }, h("i", { style: { width: `${Math.round(info.ratio * 100)}%` } }))
						: null
				);
			}
			if (info.unlimited) {
				return h(
					"div",
					null,
					h(
						"div",
						{ className: "nb-hero" },
						h("span", { className: "nb-label" }, "已用"),
						h("span", { className: "nb-val" }, h("span", { className: "nb-cur" }, info.symbol), info.used ?? "—"),
						h("span", { className: "nb-spacer" }),
						h("span", { className: "nb-badge" }, "额度不限")
					),
					h("div", { className: "nb-sub" }, "这把密钥没有额度上限，站点不返回剩余"),
					h(
						"div",
						{ style: { marginTop: 6 } },
						h(
							"button",
							{ type: "button", className: "nb-cta", onClick: actions.onConfigure },
							actions.mode === "account" ? "访问令牌似乎没生效，点此检查" : "填访问令牌看账户余额"
						)
					)
				);
			}
			return h(
				"div",
				null,
				h("div", { className: "nb-hero" }, h("span", { className: "nb-label" }, "已用"), h("span", { className: "nb-val nb-val-sm" }, h("span", { className: "nb-cur" }, info.symbol), info.used ?? "—")),
				h("div", { className: "nb-note" }, "站点没有返回剩余额度"),
				h(
					"div",
					{ style: { marginTop: 6 } },
					h(
						"button",
						{ type: "button", className: "nb-cta", onClick: actions.onConfigure },
						actions.mode === "account" ? "访问令牌似乎没生效，点此检查" : "填访问令牌看账户余额"
					)
				)
			);
		}

		const PANEL_STORE = "dsh-newapi-balance:panel-position";

		const clampTo = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)));

		function storedPosition() {
			try {
				const raw = window.localStorage.getItem(PANEL_STORE);
				if (raw === null) return undefined;
				const parsed = JSON.parse(raw);
				if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) return undefined;
				return { left: parsed.left, top: parsed.top };
			} catch {
				return undefined;
			}
		}

		function rememberPosition(position) {
			try {
				if (position === undefined) window.localStorage.removeItem(PANEL_STORE);
				else window.localStorage.setItem(PANEL_STORE, JSON.stringify(position));
			} catch {
				/* a private window without storage just forgets the spot */
			}
		}

		function Panel(props) {
			const { info, state, busy, refresh, onClose, onSavedConfig } = props;
			const [editing, setEditing] = React.useState(props.initialEditing === true);
			const site = state?.siteName || hostOf(state?.site) || "中转站";
			const updated = state?.updatedAt !== undefined ? clockOf(state.updatedAt) : "";
			const anchor = props.anchor ?? { left: 8, bottom: 8 };
			// Dragging: the capsule opens anchored above its trigger, then stays wherever
			// it was dropped (remembered per browser) until the header is double-clicked.
			const panelRef = React.useRef(null);
			const dragRef = React.useRef(undefined);
			const [placed, setPlaced] = React.useState(storedPosition);
			const placedRef = React.useRef(placed);
			placedRef.current = placed;

			const grip = (event) => {
				if (event.button !== 0) return;
				if (event.target?.closest?.("button")) return;
				const element = panelRef.current;
				if (element === null) return;
				const box = element.getBoundingClientRect();
				dragRef.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, width: box.width, height: box.height };
				setPlaced({ left: box.left, top: box.top });
				try {
					event.currentTarget.setPointerCapture?.(event.pointerId);
				} catch {
					/* a synthetic pointer has no capture target */
				}
				event.preventDefault();
			};

			const drag = (event) => {
				const held = dragRef.current;
				if (held === undefined) return;
				setPlaced({
					left: clampTo(event.clientX - held.dx, 8, window.innerWidth - held.width - 8),
					top: clampTo(event.clientY - held.dy, 8, window.innerHeight - held.height - 8)
				});
			};

			const letGo = (event) => {
				if (dragRef.current === undefined) return;
				dragRef.current = undefined;
				try {
					event.currentTarget.releasePointerCapture?.(event.pointerId);
				} catch {
					/* nothing captured */
				}
			};

			React.useEffect(() => {
				if (placed === undefined) return;
				rememberPosition(placed);
			}, [placed]);

			// A smaller window must not swallow the capsule: nudge it back into view.
			React.useEffect(() => {
				// The capsule width is fixed, so a remembered spot is clamped against that
				// constant rather than a box measured before the stylesheet applies.
				const fit = () => {
					const current = placedRef.current;
					const element = panelRef.current;
					if (current === undefined || element === null) return;
					const measured = element.getBoundingClientRect().height;
					const height = measured > 40 && measured < window.innerHeight - 16 ? measured : 0;
					setPlaced({
						left: clampTo(current.left, 8, window.innerWidth - PANEL_W - 8),
						top: height === 0 ? clampTo(current.top, 8, window.innerHeight - 96) : clampTo(current.top, 8, window.innerHeight - height - 8)
					});
				};
				const frame = window.setTimeout(fit, 0);
				window.addEventListener("resize", fit);
				return () => {
					window.clearTimeout(frame);
					window.removeEventListener("resize", fit);
				};
			}, []);

			const actions = {
				onConfigure: () => setEditing(true),
				mode: state?.config?.hasAccessToken === true ? "account" : "key"
			};

			// Keep the panel from stealing focus from its own inputs, but still avoid
			// the composer taking focus when the panel is clicked elsewhere.
			const keepFocus = (event) => {
				const tag = event.target?.tagName;
				if (tag !== "INPUT" && tag !== "BUTTON" && tag !== "LABEL" && tag !== "TEXTAREA") event.preventDefault();
			};

			const placement =
				placed === undefined
					? { left: `${anchor.left}px`, bottom: `${anchor.bottom}px` }
					: { left: `${placed.left}px`, top: `${placed.top}px` };

			return h(
				"div",
				{
					ref: panelRef,
					className: `nb-panel${placed === undefined ? "" : " nb-panel-placed"}`,
					role: "dialog",
					"aria-label": "中转站余量",
					style: { "--nb-state": info.tone, ...placement },
					onMouseDown: keepFocus
				},
				h(
					"div",
					{
						className: "nb-head",
						title: "按住拖动可移动，双击回到输入框上方",
						onPointerDown: grip,
						onPointerMove: drag,
						onPointerUp: letGo,
						onPointerCancel: letGo,
						onDoubleClick: () => setPlaced(undefined)
					},
					h("span", { className: `nb-dot${info.busy === true || busy ? " nb-dot-live" : ""}` }),
					h("span", { className: "nb-site", title: hostOf(state?.site) || site }, editing ? "配置余量查询" : site),
					editing ? null : info.ok === true ? h("span", { className: "nb-src" }, info.source) : null,
					h("span", { className: "nb-spacer" }),
					editing
						? null
						: h(
								"button",
								{
									type: "button",
									className: "nb-icon",
									title: "配置",
									"aria-pressed": false,
									onClick: () => setEditing(true)
								},
								"⚙"
							),
					editing
						? null
						: h(
								"button",
								{ type: "button", className: `nb-icon${busy ? " nb-icon-busy" : ""}`, title: "刷新", onClick: () => refresh(true) },
								"↻"
							),
					h("button", { type: "button", className: "nb-icon", title: "收起", onClick: onClose }, "×")
				),
				editing
					? h(ConfigForm, { config: state?.config, onCancel: () => setEditing(false), onSaved: onSavedConfig })
					: h(Hero, info, actions),
				editing
					? null
					: info.ok === true
						? h(
								"div",
								{ className: "nb-foot" },
								h("span", { className: "nb-foot-text", title: info.who ?? "" }, info.who ?? ""),
								h("span", { className: "nb-spacer" }),
								info.stale === true
									? h("span", { className: "nb-foot-text nb-stale", title: "站点限流，暂用上次读数" }, updated === "" ? "限流中" : `${updated} 的数据`)
									: updated === ""
										? null
										: h("span", { className: "nb-foot-text" }, `更新于 ${updated}`)
							)
						: h(
								"div",
								{ className: "nb-foot" },
								h("span", { className: "nb-foot-text" }, hostOf(state?.site) || "未配置"),
								h("span", { className: "nb-spacer" }),
								h("button", { type: "button", className: "nb-link", onClick: () => refresh(true) }, "重试")
							)
			);
		}

		const RING_R = 9;
		const RING_LENGTH = 2 * Math.PI * RING_R;
		// Keep a sliver of arc even when almost nothing is left, so a nearly empty
		// ring still reads as a ring instead of a lone dot.
		const RING_MIN_SWEEP = 0.035;

		/**
		 * The collapsed trigger: a small gauge. The ring fills with the share that is
		 * left, walking from green at full towards red near empty, and the middle shows
		 * that percentage — or ∞ for an uncapped key, ! when the read failed.
		 */
		function BalanceChip(info) {
			const hasShare = info.percent !== undefined;
			const left = Math.max(0, Math.min(1, info.left ?? 0));
			const uncapped = info.unlimited === true;
			const failed = info.err === true && !uncapped && !hasShare;
			// A cap-less key owns the whole ring; a failed read owns none of it.
			const sweep = hasShare ? Math.max(RING_MIN_SWEEP, left) : uncapped ? 1 : 0;
			const color = info.ringTone ?? "var(--dsw-alias-brand-primary,#3b82f6)";
			const label = hasShare ? String(info.percent) : uncapped ? "∞" : failed ? "!" : "…";
			const labelTone = hasShare
				? left <= 0.15
					? color
					: undefined
				: uncapped
					? "var(--dsw-alias-brand-primary,#3b82f6)"
					: failed
						? "var(--dsw-alias-state-error-primary,#e5484d)"
						: "var(--dsw-alias-label-tertiary,#9ca3af)";
			return h(
				"svg",
				{ className: "nb-ring", viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": "true" },
				h("circle", { className: "nb-ring-track", cx: 12, cy: 12, r: RING_R, fill: "none", strokeWidth: 2.6 }),
				hasShare || uncapped
					? h("circle", {
							className: "nb-ring-arc",
							cx: 12,
							cy: 12,
							r: RING_R,
							fill: "none",
							strokeWidth: 2.6,
							strokeLinecap: "round",
							strokeDasharray: RING_LENGTH.toFixed(2),
							strokeDashoffset: (RING_LENGTH * (1 - sweep)).toFixed(2),
							transform: "rotate(-90 12 12)",
							style: { stroke: color }
						})
					: null,
				h(
					"text",
					{
						className: "nb-ring-text",
						x: 12,
						y: 12.5,
						textAnchor: "middle",
						dominantBaseline: "middle",
						style: labelTone === undefined ? undefined : { fill: labelTone }
					},
					label
				)
			);
		}

		function RelayBalanceCapsule() {
			const { state, busy, refresh } = useReadout();
			const [open, setOpen] = React.useState(false);
			const [anchor, setAnchor] = React.useState(undefined);
			const rootRef = React.useRef(null);
			const triggerRef = React.useRef(null);
			const info = describe(state);
			// A fresh install opens on the form: the dot alone is not much of an answer.
			const unconfigured = state !== undefined && (state.config?.baseUrl ?? "") === "";

			// The capsule hangs above the dot, in fixed coordinates: the composer card
			// sits at the bottom of the window, so anything anchored inside it can only
			// grow upward, and a fixed layer cannot be clipped by the composer's parents.
			React.useLayoutEffect(() => {
				if (!open) {
					setAnchor(undefined);
					return undefined;
				}
				const place = () => {
					const trigger = triggerRef.current;
					if (trigger === null) return;
					const box = trigger.getBoundingClientRect();
					const viewport = window.innerWidth;
					const left = Math.round(Math.max(8, Math.min(box.right - PANEL_W, viewport - PANEL_W - 8)));
					const bottom = Math.round(Math.max(8, window.innerHeight - box.top + 8));
					setAnchor({ left, bottom });
				};
				place();
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [open]);

			// Esc and a click anywhere else both put the capsule away.
			React.useEffect(() => {
				if (!open) return undefined;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				const onDown = (event) => {
					if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
				};
				document.addEventListener("keydown", onKey, true);
				document.addEventListener("pointerdown", onDown, true);
				return () => {
					document.removeEventListener("keydown", onKey, true);
					document.removeEventListener("pointerdown", onDown, true);
				};
			}, [open]);

			const toggle = () => {
				setOpen((was) => {
					if (!was) refresh(false);
					return !was;
				});
			};

			return h(
				"div",
				{
					className: "nb-root",
					ref: rootRef,
					style: { "--nb-state": info.tone },
					onMouseDown: (event) => event.stopPropagation(),
					onPointerDown: (event) => event.stopPropagation()
				},
				h(
					"button",
					{
						type: "button",
						ref: triggerRef,
						className: "nb-trigger",
						title: tip(info, state),
						"aria-label": "中转站余量",
						"aria-expanded": open,
						onClick: toggle
					},
					info.left !== undefined || info.unlimited === true || info.ok !== true
						? h(BalanceChip, info)
						: h("span", { className: `nb-dot${info.busy === true || busy ? " nb-dot-live" : ""}` })
				),
				open && anchor !== undefined
					? h(Panel, {
							info,
							state,
							busy,
							refresh,
							anchor,
							initialEditing: unconfigured || info.calm === true,
							onSavedConfig: () => refresh(true),
							onClose: () => setOpen(false)
						})
					: null
			);
		}

		/* ------------------------------------------------------------------ */
		/* Wiring                                                              */
		/* ------------------------------------------------------------------ */

		/** Client-half services this bundle needs before it can register. */
		const inject = ["slots"];

		function apply(ctx) {
			injectStyles();

			const take = () => {
				try {
					ctx.slots.inject("conversation.input.overlay", () =>
						ctx.slots.register(
							{ name: "conversation.input.overlay", id: "newapi-balance", order: 40 },
							RelayBalanceCapsule
						)
					);
					console.info("[newapi-balance] capsule placed in conversation.input.overlay");
					return true;
				} catch (error) {
					console.error("[newapi-balance] could not take the composer overlay:", error);
					return false;
				}
			};

			if (take()) return;

			// Older shells without the overlay slot keep the previous seat below the card.
			try {
				ctx.slots.inject("conversation.composer.dock", () =>
					ctx.slots.register(
						{ name: "conversation.composer.dock", id: "newapi-balance", order: 20 },
						RelayBalanceCapsule
					)
				);
				console.info("[newapi-balance] fallback seat taken in conversation.composer.dock");
			} catch (error) {
				console.error("[newapi-balance] no usable composer seat:", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.RelayBalanceCapsule = RelayBalanceCapsule;
		exports.Panel = Panel;
		exports.ConfigForm = ConfigForm;
		exports.describe = describe;
		return module.exports;
	}
});
