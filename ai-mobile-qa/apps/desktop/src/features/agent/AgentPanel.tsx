import { useEffect, useRef, useState } from "react";
import {
    AgentRunResult,
    AgentTurnEvent,
    UnlistenFn,
    invokeRunAiAgent,
    invokeStopAiAgent,
    listenAgentTurn,
} from "../../lib/tauri";

// Same tokens as the layout.
const CARD = "#0F1420";
const BORDER = "#1C2333";
const TEXT = "#E6EDF3";
const MUTED = "#8B949E";
const DIM = "#6E7681";
const ACCENT = "#9D7BFF";
const SUCCESS = "#3FB950";
const WARN = "#E3B341";
const ERR = "#F85149";

const FORM_KEY = "tezzy.agent.form";

const PERSONAS: { id: string; label: string; text: string }[] = [
    { id: "new", label: "New user (default)", text: "" },
    {
        id: "careful",
        label: "Careful first-timer",
        text: "Reads every label before tapping, gets confused by jargon, gives up on screens that do not explain themselves.",
    },
    {
        id: "fast",
        label: "Impatient power user",
        text: "Skips onboarding and optional steps, taps fast, expects the main feature within a few taps.",
    },
    {
        id: "adversarial",
        label: "Input breaker",
        text: "Tries empty fields, very long text, emoji, wrong formats and double taps to see how the app copes.",
    },
];

type Form = {
    appName: string;
    goal: string;
    personaId: string;
    notes: string;
    email: string;
    maxActions: number;
};

const DEFAULT_FORM: Form = {
    appName: "",
    goal: "Use the app like a new user: reach its main features and visit as many screens as you can.",
    personaId: "new",
    notes: "",
    email: "",
    maxActions: 30,
};

function loadForm(): Form {
    try {
        const raw = localStorage.getItem(FORM_KEY);
        return raw ? { ...DEFAULT_FORM, ...JSON.parse(raw) } : DEFAULT_FORM;
    } catch {
        return DEFAULT_FORM;
    }
}

const label: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase",
    color: DIM, display: "block", marginBottom: 5,
};

const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "#0B0F15", border: `1px solid ${BORDER}`,
    color: TEXT, padding: "7px 9px", borderRadius: 6, fontSize: 12, outline: "none", fontFamily: "inherit",
};

const button = (color: string, disabled: boolean): React.CSSProperties => ({
    background: disabled ? "rgba(139,148,158,0.08)" : `${color}22`,
    border: `1px solid ${disabled ? BORDER : `${color}66`}`,
    color: disabled ? DIM : color, padding: "8px 16px", borderRadius: 7,
    fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
});

const END_LABEL: Record<string, string> = {
    finished: "Agent finished",
    budget: "Action budget used",
    stopped: "Stopped by you",
    session_lost: "Appium session lost",
    error: "Error",
};

export default function AgentPanel() {
    const [form, setForm] = useState<Form>(loadForm);
    const [password, setPassword] = useState("");
    const [running, setRunning] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [turns, setTurns] = useState<AgentTurnEvent[]>([]);
    const [live, setLive] = useState<AgentTurnEvent | null>(null);
    const [result, setResult] = useState<AgentRunResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const feedEnd = useRef<HTMLDivElement>(null);

    useEffect(() => {
        localStorage.setItem(FORM_KEY, JSON.stringify(form)); // the password is never stored
    }, [form]);

    useEffect(() => {
        let unlisten: UnlistenFn | undefined;
        listenAgentTurn((ev) => {
            setLive(ev);
            if (ev.status === "action") setTurns((t) => [...t, ev].slice(-200));
        }).then((u) => { unlisten = u; });
        return () => { unlisten?.(); };
    }, []);

    useEffect(() => { feedEnd.current?.scrollIntoView({ block: "nearest" }); }, [turns.length]);

    const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

    async function start() {
        setRunning(true); setStopping(false); setTurns([]); setLive(null); setResult(null); setError(null);
        const persona = PERSONAS.find((p) => p.id === form.personaId)?.text || undefined;
        try {
            const res = await invokeRunAiAgent({
                appName: form.appName || undefined,
                goal: form.goal || undefined,
                persona,
                notes: form.notes || undefined,
                email: form.email || undefined,
                password: password || undefined,
                maxActions: form.maxActions,
            });
            setResult(res);
            if (res.error) setError(res.error);
        } catch (e) {
            setError(String(e));
        } finally {
            setRunning(false); setStopping(false);
        }
    }

    function stop() {
        setStopping(true);
        invokeStopAiAgent();
    }

    const progress = live ? Math.min(100, Math.round((live.actions_taken / Math.max(live.max_actions, 1)) * 100)) : 0;

    return (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "20px 22px", color: TEXT }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>AI Agent test</h2>
                <span style={{ fontSize: 11, color: DIM }}>one agent · sees every screenshot · remembers the whole run</span>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
                Needs an active device and Appium session (Automation tab). The agent taps, types and scrolls
                through the app, reports issues as it finds them, and writes a report with numbered screenshots.
            </p>

            <fieldset disabled={running} style={{ border: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                    <span style={label}>App name</span>
                    <input style={input} value={form.appName} placeholder="e.g. BillSnap"
                        onChange={(e) => set("appName", e.target.value)} />
                </div>
                <div>
                    <span style={label}>Tester persona</span>
                    <select style={input} value={form.personaId} onChange={(e) => set("personaId", e.target.value)}>
                        {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                    <span style={label}>Goal</span>
                    <textarea style={{ ...input, minHeight: 54, resize: "vertical" }} value={form.goal}
                        onChange={(e) => set("goal", e.target.value)} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                    <span style={label}>Notes for the agent (optional)</span>
                    <textarea style={{ ...input, minHeight: 40, resize: "vertical" }} value={form.notes}
                        placeholder="What to focus on, what is out of scope, known bugs to ignore..."
                        onChange={(e) => set("notes", e.target.value)} />
                </div>
                <div>
                    <span style={label}>Test e-mail (optional)</span>
                    <input style={input} value={form.email} placeholder="tester@example.com" autoComplete="off"
                        onChange={(e) => set("email", e.target.value)} />
                </div>
                <div>
                    <span style={label}>Test password (not saved)</span>
                    <input style={input} type="password" value={password} autoComplete="off"
                        onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div>
                    <span style={label}>Action budget: {form.maxActions}</span>
                    <input type="range" min={5} max={100} step={5} value={form.maxActions} style={{ width: "100%" }}
                        onChange={(e) => set("maxActions", Number(e.target.value))} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, justifyContent: "flex-end" }}>
                    {!running && <button style={button(ACCENT, false)} onClick={start}>Start agent</button>}
                </div>
            </fieldset>
            {running && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                    <button style={button(ERR, stopping)} disabled={stopping} onClick={stop}>
                        {stopping ? "Stopping, writing report..." : "Stop"}
                    </button>
                </div>
            )}

            {(running || live) && (
                <div style={{ marginTop: 18 }}>
                    <div style={{ display: "flex", gap: 16, fontSize: 12, color: MUTED, marginBottom: 6, flexWrap: "wrap" }}>
                        <span>Step <b style={{ color: TEXT }}>{live?.step ?? 0}</b></span>
                        <span>Actions <b style={{ color: TEXT }}>{live?.actions_taken ?? 0}/{live?.max_actions ?? form.maxActions}</b></span>
                        <span>Screen <b style={{ color: TEXT }}>{live?.screen_id ?? "-"}</b></span>
                        <span>Issues <b style={{ color: (live?.findings_count ?? 0) > 0 ? WARN : TEXT }}>{live?.findings_count ?? 0}</b></span>
                        {running && <span style={{ color: ACCENT }}>{live?.status === "observing" ? "looking at the screen..." : "acting..."}</span>}
                    </div>
                    <div style={{ height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${progress}%`, height: "100%", background: ACCENT, transition: "width .3s" }} />
                    </div>
                </div>
            )}

            {turns.length > 0 && (
                <div style={{
                    marginTop: 14, maxHeight: 320, overflowY: "auto", border: `1px solid ${BORDER}`,
                    borderRadius: 8, background: "#0B0F15",
                }}>
                    {turns.map((t, i) => (
                        <div key={`${t.run_id}-${t.step}-${i}`} style={{
                            display: "grid", gridTemplateColumns: "34px 36px 1fr", gap: 8, padding: "7px 10px",
                            borderBottom: `1px solid ${BORDER}`, fontSize: 12,
                        }}>
                            <span style={{ color: DIM, fontFamily: "monospace" }}>{String(t.step).padStart(2, "0")}</span>
                            <span style={{ color: t.new_screen ? SUCCESS : DIM, fontFamily: "monospace" }} title={t.new_screen ? "new screen" : ""}>
                                {t.screen_id ?? ""}{t.new_screen ? "*" : ""}
                            </span>
                            <span>
                                <span style={{ color: TEXT, fontFamily: "monospace" }}>{t.action}</span>
                                {t.thought && <span style={{ color: MUTED }}> · {t.thought}</span>}
                            </span>
                        </div>
                    ))}
                    <div ref={feedEnd} />
                </div>
            )}

            {error && (
                <div style={{
                    marginTop: 14, padding: "10px 12px", borderRadius: 8, fontSize: 12,
                    background: "rgba(248,81,73,0.08)", border: "1px solid rgba(248,81,73,0.3)", color: ERR,
                }}>{error}</div>
            )}

            {result && (
                <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "#0B0F15" }}>
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: MUTED, marginBottom: 8 }}>
                        <span style={{ color: result.end_reason === "finished" ? SUCCESS : WARN, fontWeight: 700 }}>
                            {END_LABEL[result.end_reason] ?? result.end_reason}
                        </span>
                        <span>Goal reached: <b style={{ color: TEXT }}>{result.goal_reached ?? "-"}</b></span>
                        <span>Score: <b style={{ color: TEXT }}>{result.score != null ? `${result.score}/10` : "-"}</b></span>
                        <span>Screens: <b style={{ color: TEXT }}>{result.screens_reached}</b></span>
                        <span>Issues: <b style={{ color: result.findings_count ? WARN : TEXT }}>{result.findings_count}</b></span>
                        <span>Actions: <b style={{ color: TEXT }}>{result.actions_taken}</b></span>
                    </div>
                    {result.summary && <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.5 }}>{result.summary}</p>}
                    {result.report_path && (
                        <div style={{ fontSize: 11, color: DIM }}>
                            Report: <code style={{ color: MUTED, userSelect: "all" }}>{result.report_path}</code>
                        </div>
                    )}
                    <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>
                        Model: {result.model} · Open each issue's screenshots before filing it: the agent can misread a screen.
                    </div>
                </div>
            )}
        </div>
    );
}
