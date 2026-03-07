import { useState, useEffect, useRef } from "react";
import {
    invokeRunSmokeCheck,
    invokeStopSmokeCheck,
    listenRunProgress,
    RunProgressEvent,
    SmokeCheckResult,
    UnlistenFn,
} from "../../lib/tauri";

const accent = "#9D7BFF";
const warn = "#E3B341";
const error = "#F85149";
const success = "#3FB950";

// ── helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
    if (status === "running") return accent;
    if (status === "warn") return warn;
    if (status === "error" || status === "crash") return error;
    if (status === "done" || status === "complete") return success;
    if (status === "stopped") return "#8B949E";
    return "#8B949E";
}

function resultIcon(status: string): string {
    if (status === "ok") return "✓";
    if (status === "dead_tap") return "○";
    if (status === "loop") return "↻";
    if (status === "crash") return "✕";
    if (status === "stopped") return "■";
    if (status === "warn") return "△";
    return "•";
}

function findingIcon(severity: string): string {
    if (severity === "error") return "●";
    if (severity === "warn") return "▲";
    return "ℹ";
}

function findingColor(severity: string): string {
    if (severity === "error") return error;
    if (severity === "warn") return warn;
    return accent;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function SmokeCheckPanel() {
    const [running, setRunning] = useState(false);
    const [maxSteps, setMaxSteps] = useState(20);
    const [delayMs, setDelayMs] = useState(1500);
    const [progress, setProgress] = useState<RunProgressEvent[]>([]);
    const [result, setResult] = useState<SmokeCheckResult | null>(null);
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const feedRef = useRef<HTMLDivElement>(null);
    const unlistenRef = useRef<UnlistenFn | undefined>(undefined);

    // Auto-scroll the step feed to the bottom
    useEffect(() => {
        const feed = feedRef.current;
        if (feed) feed.scrollTop = feed.scrollHeight;
    }, [progress]);

    // Clean up listener on unmount
    useEffect(() => {
        return () => { unlistenRef.current?.(); };
    }, []);

    const handleStart = async () => {
        setRunning(true);
        setProgress([]);
        setResult(null);
        setErrMsg(null);

        // Subscribe to per-step events
        unlistenRef.current?.();
        unlistenRef.current = await listenRunProgress((evt) => {
            setProgress((prev) => [...prev, evt]);
        });

        try {
            const res = await invokeRunSmokeCheck(maxSteps, delayMs);
            setResult(res);
        } catch (err) {
            setErrMsg(String(err));
        } finally {
            unlistenRef.current?.();
            unlistenRef.current = undefined;
            setRunning(false);
        }
    };

    const handleStop = () => {
        invokeStopSmokeCheck();
    };

    // Most recent progress event
    const latest = progress[progress.length - 1];
    const stepsDone = result?.steps_done ?? (latest ? latest.step : 0);
    const totalSteps = result?.max_steps ?? maxSteps;
    const progressPct = totalSteps > 0 ? Math.round((stepsDone / totalSteps) * 100) : 0;

    return (
        <div style={{
            border: "1px solid #1a2030",
            borderRadius: "14px",
            background: "#0A0D14",
            overflow: "hidden",
        }}>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 18px 10px",
                borderBottom: "1px solid #1a2030",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {/* Icon */}
                    <div style={{
                        width: 28, height: 28, borderRadius: "8px",
                        background: "rgba(157,123,255,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                        </svg>
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#E6EDF3" }}>
                        Auto Smoke Check
                    </span>
                    {running && (
                        <span style={{
                            background: "rgba(157,123,255,0.15)", color: accent,
                            borderRadius: "10px", padding: "1px 8px", fontSize: "10px", fontWeight: 700,
                            animation: "pulse 1.5s ease-in-out infinite",
                        }}>
                            Running
                        </span>
                    )}
                    {result && !running && (
                        <span style={{
                            background: result.final_status === "complete"
                                ? "rgba(63,185,80,0.12)"
                                : result.final_status === "crash"
                                    ? "rgba(248,81,73,0.12)"
                                    : "rgba(227,179,65,0.12)",
                            color: result.final_status === "complete" ? success
                                : result.final_status === "crash" ? error : warn,
                            borderRadius: "10px", padding: "1px 8px", fontSize: "10px", fontWeight: 700,
                        }}>
                            {result.final_status}
                        </span>
                    )}
                </div>

                {/* Controls */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {/* Steps control */}
                    {!running && (
                        <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#6E7681" }}>
                            Steps
                            <input
                                type="number"
                                min={1}
                                max={50}
                                value={maxSteps}
                                onChange={(e) => setMaxSteps(Math.max(1, Math.min(50, Number(e.target.value))))}
                                style={{
                                    width: "44px",
                                    background: "#0F1520",
                                    border: "1px solid #20252E",
                                    borderRadius: "6px",
                                    color: "#C9D1D9",
                                    fontSize: "11px",
                                    padding: "3px 6px",
                                    outline: "none",
                                }}
                            />
                        </label>
                    )}
                    {/* Delay control */}
                    {!running && (
                        <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#6E7681" }}>
                            Delay
                            <select
                                value={delayMs}
                                onChange={(e) => setDelayMs(Number(e.target.value))}
                                style={{
                                    background: "#0F1520",
                                    border: "1px solid #20252E",
                                    borderRadius: "6px",
                                    color: "#C9D1D9",
                                    fontSize: "11px",
                                    padding: "3px 6px",
                                    outline: "none",
                                    cursor: "pointer",
                                }}
                            >
                                <option value={500}>0.5 s</option>
                                <option value={1000}>1 s</option>
                                <option value={1500}>1.5 s</option>
                                <option value={2000}>2 s</option>
                                <option value={3000}>3 s</option>
                            </select>
                        </label>
                    )}

                    {/* Action button */}
                    {running ? (
                        <button
                            onClick={handleStop}
                            style={{
                                border: `1px solid ${error}44`,
                                borderRadius: "8px",
                                padding: "5px 14px",
                                background: "rgba(248,81,73,0.08)",
                                color: error,
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            ■ Stop
                        </button>
                    ) : (
                        <button
                            onClick={handleStart}
                            style={{
                                border: `1px solid ${accent}55`,
                                borderRadius: "8px",
                                padding: "5px 14px",
                                background: "rgba(157,123,255,0.1)",
                                color: accent,
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                                transition: "background 0.15s",
                            }}
                        >
                            ▶ Run
                        </button>
                    )}
                </div>
            </div>

            {/* ── Progress bar ────────────────────────────────────────────── */}
            {(running || result) && (
                <div style={{ padding: "8px 18px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "10px", color: "#6E7681" }}>
                            {running ? latest?.action ?? "Starting…" : result?.final_status ?? ""}
                        </span>
                        <span style={{ fontSize: "10px", color: "#6E7681" }}>
                            {stepsDone} / {totalSteps}
                        </span>
                    </div>
                    <div style={{
                        height: "4px", borderRadius: "2px",
                        background: "#1a2030", overflow: "hidden",
                    }}>
                        <div style={{
                            height: "100%", borderRadius: "2px",
                            width: `${progressPct}%`,
                            background: result?.final_status === "crash" ? error
                                : result?.final_status === "loop" ? warn
                                    : accent,
                            transition: "width 0.3s ease",
                        }} />
                    </div>
                </div>
            )}

            {/* ── Error message ────────────────────────────────────────────── */}
            {errMsg && (
                <div style={{
                    margin: "10px 18px 0",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(248,81,73,0.07)",
                    border: "1px solid rgba(248,81,73,0.2)",
                    fontSize: "11px",
                    color: error,
                }}>
                    {errMsg}
                </div>
            )}

            {/* ── Step feed ───────────────────────────────────────────────── */}
            {progress.length > 0 && (
                <div
                    ref={feedRef}
                    style={{
                        maxHeight: "160px",
                        overflowY: "auto",
                        padding: "6px 18px",
                        marginTop: "6px",
                    }}
                >
                    {progress
                        .filter((p) => p.status !== "done" && p.action !== "done" && p.action !== "stopped")
                        .map((p, i) => (
                            <div
                                key={i}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "3px 0",
                                    borderBottom: "1px solid #10141c",
                                }}
                            >
                                <span style={{
                                    fontSize: "9px",
                                    fontWeight: 700,
                                    color: "#2a3040",
                                    width: "24px",
                                    flexShrink: 0,
                                    textAlign: "right",
                                }}>
                                    {p.step}
                                </span>
                                <span style={{
                                    fontSize: "11px",
                                    color: statusColor(p.status),
                                    fontWeight: 600,
                                    flexShrink: 0,
                                }}>
                                    {resultIcon(p.status)}
                                </span>
                                <span style={{
                                    fontSize: "11px",
                                    color: "#8B949E",
                                    flex: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}>
                                    {p.action}
                                </span>
                            </div>
                        ))}
                </div>
            )}

            {/* ── Findings summary ─────────────────────────────────────────── */}
            {result && result.findings.length > 0 && (
                <div style={{
                    margin: "8px 18px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(227,179,65,0.05)",
                    border: "1px solid rgba(227,179,65,0.15)",
                }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: warn, marginBottom: "4px", letterSpacing: "0.4px" }}>
                        {result.findings.length} FINDING{result.findings.length !== 1 ? "S" : ""}
                    </div>
                    {result.findings.map((f, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "2px" }}>
                            <span style={{ fontSize: "10px", color: findingColor(f.severity), flexShrink: 0, marginTop: "1px" }}>
                                {findingIcon(f.severity)}
                            </span>
                            <span style={{
                                fontSize: "10px",
                                color: "#8B949E",
                                lineHeight: 1.5,
                                overflow: "hidden",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                            }}>
                                <strong style={{ color: findingColor(f.severity) }}>
                                    [step {f.step}]
                                </strong>{" "}
                                {f.message}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Report link ──────────────────────────────────────────────── */}
            {result?.report_path && (
                <div style={{
                    padding: "6px 18px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "10px",
                    color: "#6E7681",
                }}>
                    <span>📄</span>
                    <span style={{ color: accent, fontWeight: 600 }}>Report:</span>
                    <span
                        title={result.report_path}
                        style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontFamily: "monospace",
                            fontSize: "10px",
                            color: "#8B949E",
                            flex: 1,
                        }}
                    >
                        {result.report_path.split(/[/\\]/).pop()}
                    </span>
                    <button
                        onClick={() => {
                            // Open the folder containing the report using Tauri shell API
                            import("@tauri-apps/api/shell").then(({ open }) => {
                                const dir = result.report_path!.replace(/[/\\][^/\\]+$/, "");
                                open(dir).catch(() => {});
                            });
                        }}
                        style={{
                            flexShrink: 0,
                            border: `1px solid ${accent}33`,
                            borderRadius: "5px",
                            padding: "2px 8px",
                            background: "rgba(157,123,255,0.07)",
                            color: accent,
                            fontSize: "10px",
                            fontWeight: 700,
                            cursor: "pointer",
                        }}
                    >
                        Open folder
                    </button>
                </div>
            )}

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </div>
    );
}
