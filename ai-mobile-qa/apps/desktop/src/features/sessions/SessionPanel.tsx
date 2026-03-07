import { useState, useEffect } from "react";
import {
    invokeStartAppium,
    invokeStopAppium,
    invokeGetAppiumStatus,
    invokeCreateSession,
    invokeDestroySession,
    invokeActionTap,
    invokeActionBack,
    invokeActionSwipe,
    invokeActionInput,
    invokeActionScreenshot,
    listenAppiumState,
    listenSessionState,
    AppiumStateEvent,
    SessionStateEvent,
    UnlistenFn,
} from "../../lib/tauri";

const accent = "#9D7BFF";

type Props = {
    prefillTap?: { x: number; y: number } | null;
    onPrefillConsumed?: () => void;
};

const chip = (active: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: "5px",
    padding: "3px 9px", borderRadius: "20px", fontSize: "10px", fontWeight: 600,
    letterSpacing: "0.3px", userSelect: "none",
    background: active ? "rgba(63,185,80,0.1)" : "rgba(139,148,158,0.08)",
    border: `1px solid ${active ? "rgba(63,185,80,0.25)" : "#1e2530"}`,
    color: active ? "#3FB950" : "#6E7681",
});

const dot = (color: string, glow = false): React.CSSProperties => ({
    width: 6, height: 6, borderRadius: "50%",
    display: "inline-block", flexShrink: 0,
    background: color,
    boxShadow: glow ? `0 0 6px ${color}` : "none",
});

const sectionLabel: React.CSSProperties = {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.6px",
    textTransform: "uppercase", color: "#4a5568",
    marginBottom: "10px", display: "block",
};

export default function SessionPanel({ prefillTap, onPrefillConsumed }: Props) {
    const [appiumStatus, setAppiumStatus] = useState<string>("stopped");
    const [appiumMessage, setAppiumMessage] = useState<string>("");
    const [appiumRunning, setAppiumRunning] = useState(false);
    const [sessionStatus, setSessionStatus] = useState<string>("none");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Manual action inputs
    const [tapX, setTapX] = useState("");
    const [tapY, setTapY] = useState("");
    const [inputText, setInputText] = useState("");

    // Apply prefilled coordinates from visual picker or inspector
    useEffect(() => {
        if (prefillTap) {
            setTapX(String(prefillTap.x));
            setTapY(String(prefillTap.y));
            onPrefillConsumed?.();
        }
    }, [prefillTap]);


    useEffect(() => {
        let unlistenAppium: UnlistenFn | undefined;
        let unlistenSession: UnlistenFn | undefined;

        listenAppiumState((state: AppiumStateEvent) => {
            setAppiumStatus(state.status);
            setAppiumMessage(state.message ?? "");
            setAppiumRunning(state.status === "running");
        }).then((stop) => { unlistenAppium = stop; });

        listenSessionState((state: SessionStateEvent) => {
            setSessionStatus(state.status);
            setSessionId(state.session_id ?? null);
            setSessionError(state.status === "error" ? (state.message ?? "Session failed") : null);
        }).then((stop) => { unlistenSession = stop; });

        invokeGetAppiumStatus().then((s) => {
            setAppiumRunning(s.running);
            setAppiumStatus(s.running ? "running" : "stopped");
        });

        return () => { unlistenAppium?.(); unlistenSession?.(); };
    }, []);

    const run = async (fn: () => Promise<unknown>) => {
        setLoading(true);
        try { await fn(); } catch (err) { console.error(err); } finally { setLoading(false); }
    };

    const serverColor =
        appiumStatus === "running"  ? "#3FB950" :
        appiumStatus === "error"    ? "#F85149" :
        appiumStatus === "starting" ? "#E3B341" : "#4a5568";

    const chipStyle: React.CSSProperties = {
        display: "inline-flex", alignItems: "center", gap: "5px",
        padding: "3px 9px", borderRadius: "20px", fontSize: "10px", fontWeight: 600,
        letterSpacing: "0.3px", userSelect: "none",
        background: appiumRunning ? "rgba(63,185,80,0.1)" : "rgba(139,148,158,0.08)",
        border: `1px solid ${appiumRunning ? "rgba(63,185,80,0.25)" : "#1e2530"}`,
        color: appiumRunning ? "#3FB950" : "#6E7681",
    };

    const sectionLabel: React.CSSProperties = {
        fontSize: "10px", fontWeight: 700, letterSpacing: "0.7px",
        textTransform: "uppercase", color: "#4a5568",
        marginBottom: "10px", display: "block",
    };

    const cardStyle: React.CSSProperties = {
        background: "#070B10", border: "1px solid #1a2030",
        borderRadius: "12px", padding: "14px 16px", marginBottom: "10px",
    };

    const inputStyle: React.CSSProperties = {
        background: "#020407", border: "1px solid #1e2530",
        color: "#C9D1D9", padding: "8px 10px", borderRadius: "8px",
        fontSize: "12px", outline: "none",
    };

    const ghostBtn = (disabled = false): React.CSSProperties => ({
        background: disabled ? "transparent" : "#0F1520",
        border: "1px solid #1e2530",
        color: disabled ? "#2a3040" : "#8B949E",
        padding: "7px 0", borderRadius: "8px",
        fontSize: "11px", fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        flex: 1, letterSpacing: "0.2px",
    });

    return (
        <div style={{ display: "flex", flexDirection: "column", padding: "18px 20px", gap: 0 }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <div style={{
                        width: 30, height: 30, borderRadius: "8px",
                        background: "rgba(157,123,255,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
                        </svg>
                    </div>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#E6EDF3", letterSpacing: "-0.2px" }}>Automation</span>
                </div>
                <div style={chipStyle}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block", background: serverColor, boxShadow: appiumRunning ? `0 0 6px ${serverColor}` : "none" }} />
                    {appiumStatus === "starting" ? "starting..." : appiumStatus}
                </div>
            </div>

            {/* Appium Server card */}
            <div style={cardStyle}>
                <span style={sectionLabel}>Appium Server</span>

                {appiumRunning && (
                    <div style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        padding: "8px 10px", borderRadius: "8px", marginBottom: "10px",
                        background: "rgba(63,185,80,0.05)", border: "1px solid rgba(63,185,80,0.12)",
                    }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3FB950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/>
                            <path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3"/>
                        </svg>
                        <span style={{ fontSize: "11px", color: "#3FB950", fontWeight: 600 }}>127.0.0.1:4723</span>
                        <span style={{ marginLeft: "auto", fontSize: "10px", color: "#4a5568" }}>WebDriver Ready</span>
                    </div>
                )}

                {appiumStatus === "error" && appiumMessage && (
                    <div style={{
                        padding: "9px 11px", borderRadius: "8px", marginBottom: "10px",
                        background: "rgba(248,81,73,0.07)", border: "1px solid rgba(248,81,73,0.2)",
                        fontSize: "11px", color: "#F85149", lineHeight: 1.6, whiteSpace: "pre-wrap",
                    }}>
                        {appiumMessage}
                    </div>
                )}

                {!appiumRunning ? (
                    <button
                        onClick={() => run(invokeStartAppium)}
                        disabled={loading || appiumStatus === "starting"}
                        style={{
                            width: "100%", border: "none", borderRadius: "9px",
                            padding: "10px 0", fontWeight: 700, fontSize: "12px",
                            cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.3px",
                            background: appiumStatus === "starting" ? "rgba(227,179,65,0.12)" : `linear-gradient(135deg, ${accent}, #7B5CE5)`,
                            color: appiumStatus === "starting" ? "#E3B341" : "#fff",
                            opacity: loading ? 0.6 : 1,
                            boxShadow: appiumStatus !== "starting" && !loading ? "0 3px 12px rgba(157,123,255,0.25)" : "none",
                        }}
                    >
                        {appiumStatus === "starting" ? "Starting..." : "▶︎  Start Server"}
                    </button>
                ) : (
                    <button
                        onClick={() => run(invokeStopAppium)}
                        disabled={loading}
                        style={{
                            width: "100%", border: "1px solid rgba(248,81,73,0.25)", borderRadius: "9px",
                            padding: "10px 0", fontWeight: 700, fontSize: "12px",
                            cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.3px",
                            background: "rgba(248,81,73,0.08)", color: "#F85149", opacity: loading ? 0.6 : 1,
                        }}
                    >
                        ■︎  Stop Server
                    </button>
                )}
            </div>

            {/* Session card */}
            <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <span style={{ ...sectionLabel, marginBottom: 0 }}>Session</span>
                    {sessionId && (
                        <span style={{ fontSize: "10px", color: "#4a5568", fontFamily: "monospace" }}>
                            {sessionId.substring(0, 12)}...
                        </span>
                    )}
                </div>

                {sessionError && (
                    <div style={{
                        padding: "9px 11px", borderRadius: "8px", marginBottom: "10px",
                        background: "rgba(248,81,73,0.07)", border: "1px solid rgba(248,81,73,0.2)",
                        fontSize: "11px", color: "#F85149", lineHeight: 1.6, whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                    }}>
                        {sessionError}
                    </div>
                )}

                {sessionStatus !== "active" ? (
                    <button
                        onClick={() => { setSessionError(null); run(invokeCreateSession); }}
                        disabled={loading || !appiumRunning || sessionStatus === "creating"}
                        style={{
                            width: "100%", borderRadius: "9px", padding: "10px 0",
                            fontWeight: 700, fontSize: "12px", letterSpacing: "0.3px",
                            border: `1px solid ${appiumRunning ? "#252d3d" : "#141920"}`,
                            background: appiumRunning ? "#0F1520" : "transparent",
                            color: appiumRunning ? "#C9D1D9" : "#2a3040",
                            cursor: (appiumRunning && sessionStatus !== "creating") ? "pointer" : "not-allowed",
                            opacity: loading ? 0.6 : 1,
                        }}
                    >
                        {sessionStatus === "creating" ? "⏳  Connecting..." : sessionError ? "↺  Retry" : "⚡  Connect Device"}
                    </button>
                ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{
                            flex: 1, padding: "8px 10px", borderRadius: "8px",
                            background: "rgba(63,185,80,0.05)", border: "1px solid rgba(63,185,80,0.12)",
                            display: "flex", alignItems: "center", gap: "8px",
                        }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3FB950", display: "inline-block", boxShadow: "0 0 6px #3FB950" }} />
                            <span style={{ fontSize: "11px", color: "#3FB950", fontWeight: 600 }}>Session active</span>
                        </div>
                        <button
                            onClick={() => run(invokeDestroySession)}
                            disabled={loading}
                            style={{
                                border: "1px solid rgba(248,81,73,0.2)", background: "rgba(248,81,73,0.07)",
                                color: "#F85149", borderRadius: "8px", padding: "8px 14px",
                                fontSize: "11px", fontWeight: 600, cursor: "pointer",
                            }}
                        >
                            End
                        </button>
                    </div>
                )}
            </div>

            {/* Actions — only when session active */}
            {sessionStatus === "active" && (
                <div style={cardStyle}>
                    <span style={sectionLabel}>Actions</span>

                    {/* Tap — coords come from screenshot picker or UI Inspector */}
                    <div style={{ display: "flex", gap: "6px", marginBottom: "8px", alignItems: "stretch" }}>
                        <div style={{
                            flex: 1, display: "flex", alignItems: "center",
                            background: "#020407", border: `1px solid ${tapX && tapY ? accent + "44" : "#1e2530"}`,
                            borderRadius: "8px", padding: "0 10px", gap: "6px", minWidth: 0,
                        }}>
                            {tapX && tapY ? (
                                <>
                                    <span style={{ fontSize: "10px", color: accent, fontWeight: 700, whiteSpace: "nowrap" }}>
                                        📍 {tapX}, {tapY}
                                    </span>
                                    <button
                                        onClick={() => { setTapX(""); setTapY(""); }}
                                        style={{ marginLeft: "auto", background: "none", border: "none", color: "#4a5568", fontSize: "13px", cursor: "pointer", lineHeight: 1, padding: 0 }}
                                    >×</button>
                                </>
                            ) : (
                                <span style={{ fontSize: "10px", color: "#3a4455", fontStyle: "italic" }}>
                                    Pick from screenshot or inspector →
                                </span>
                            )}
                        </div>
                        <button
                            onClick={() => { const x = parseInt(tapX), y = parseInt(tapY); if (!isNaN(x) && !isNaN(y)) run(() => invokeActionTap(x, y)); }}
                            disabled={!tapX || !tapY}
                            style={{
                                padding: "0 18px",
                                background: tapX && tapY ? `linear-gradient(135deg, ${accent}, #7B5CE5)` : "#0D1117",
                                border: `1px solid ${tapX && tapY ? "transparent" : "#1e2530"}`,
                                color: tapX && tapY ? "#fff" : "#2a3040",
                                borderRadius: "8px", fontSize: "11px", fontWeight: 700,
                                cursor: tapX && tapY ? "pointer" : "not-allowed",
                                boxShadow: tapX && tapY ? "0 2px 10px rgba(157,123,255,0.3)" : "none",
                                transition: "all 0.15s", whiteSpace: "nowrap",
                            }}
                        >
                            Tap
                        </button>
                    </div>

                    {/* Nav buttons */}
                    <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                        {([
                            { label: "Back",       fn: () => invokeActionBack() },
                            { label: "Swipe Up",   fn: () => invokeActionSwipe(500, 1500, 500, 500, 500) },
                            { label: "Swipe Down", fn: () => invokeActionSwipe(500, 500, 500, 1500, 500) },
                        ] as { label: string; fn: () => Promise<unknown> }[]).map(({ label, fn }) => (
                            <button key={label} onClick={() => run(fn)} style={ghostBtn()}>{label}</button>
                        ))}
                    </div>

                    {/* Text input */}
                    <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                        <input
                            type="text" placeholder="Type text..." value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && inputText && run(() => invokeActionInput(inputText).then(() => setInputText("")))}
                            style={{ ...inputStyle, flex: 1 }}
                        />
                        <button
                            onClick={() => inputText && run(() => invokeActionInput(inputText).then(() => setInputText("")))}
                            style={{ ...ghostBtn(!inputText), padding: "7px 14px", flex: "none" }}
                        >
                            Send
                        </button>
                    </div>

                    {/* Screenshot */}
                    <button
                        onClick={() => run(() => invokeActionScreenshot())}
                        style={{
                            width: "100%", border: "1px solid rgba(157,123,255,0.2)",
                            borderRadius: "9px", padding: "10px 0",
                            fontWeight: 700, fontSize: "12px", cursor: "pointer",
                            background: "rgba(157,123,255,0.08)", color: accent,
                            letterSpacing: "0.3px",
                        }}
                    >
                        📷  Take Screenshot
                    </button>
                </div>
            )}
        </div>
    );
}
