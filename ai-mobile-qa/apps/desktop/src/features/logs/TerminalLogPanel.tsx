import { useEffect, useState } from "react";
import { LogEvent, listenLog } from "../../lib/tauri";

type LogLine  = LogEvent;
type LogLevel = "all" | "info" | "warn" | "error";

const MAX_LINES = 2000;

const ACCENT  = "#9D7BFF";
const SUCCESS = "#3FB950";
const WARN    = "#E3B341";
const ERR     = "#F85149";
const DIM     = "#6E7681";
const BORDER  = "#1C2333";

const FILTER_OPTS: { id: LogLevel; label: string; color: string }[] = [
    { id: "all",   label: "ALL",  color: DIM     },
    { id: "info",  label: "INFO", color: "#58A6FF" },
    { id: "warn",  label: "WARN", color: WARN    },
    { id: "error", label: "ERR",  color: ERR     },
];

export default function TerminalLogPanel() {
    const [lines,  setLines]  = useState<LogLine[]>([]);
    const [filter, setFilter] = useState<LogLevel>("all");

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        listenLog((event) => {
            setLines((prev) => {
                const next = [...prev, event];
                return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
            });
        }).then((stop) => { unlisten = stop; });
        return () => { unlisten?.(); };
    }, []);

    const displayed = filter === "all" ? lines : lines.filter((l) => l.level === filter);

    const levelColor = (level: string) =>
        level === "error" ? ERR : level === "warn" ? WARN : "#C9D1D9";

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Header + filter bar */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px 8px",
                borderBottom: `1px solid ${BORDER}`,
                flexShrink: 0,
            }}>
                <span style={{ color: ACCENT, fontWeight: 700, fontSize: 12, letterSpacing: "0.1px" }}>
                    System Log
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                    {FILTER_OPTS.map((opt) => {
                        const active = filter === opt.id;
                        return (
                            <button
                                key={opt.id}
                                onClick={() => setFilter(opt.id)}
                                style={{
                                    padding: "2px 8px", borderRadius: 4,
                                    border: `1px solid ${active ? opt.color + "55" : BORDER}`,
                                    background: active ? opt.color + "18" : "transparent",
                                    color: active ? opt.color : "#4a5568",
                                    fontSize: 9, fontWeight: 700,
                                    cursor: "pointer", letterSpacing: "0.4px",
                                    outline: "none",
                                    transition: "all 0.12s",
                                }}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Log body */}
            <div style={{
                flex: 1, overflowY: "auto",
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: 11, color: "#C9D1D9",
                padding: "10px 14px",
            }}>
                {displayed.length === 0 ? (
                    <div style={{ color: "#4a5568", fontStyle: "italic" }}>
                        {lines.length === 0 ? "Waiting for events..." : "No entries match filter."}
                    </div>
                ) : (
                    displayed.map((line, i) => (
                        <div key={`${line.ts}-${i}`} style={{ marginBottom: 5, lineHeight: 1.55 }}>
                            <span style={{ color: "#3a4455" }}>
                                {new Date(line.ts).toLocaleTimeString()}
                            </span>
                            {" "}
                            <span style={{ color: levelColor(line.level), fontWeight: 700 }}>
                                [{line.level.toUpperCase()}]
                            </span>
                            <span style={{ marginLeft: 7 }}>{line.message}</span>
                        </div>
                    ))
                )}
            </div>

            {/* Footer count */}
            <div style={{
                padding: "5px 14px",
                borderTop: `1px solid ${BORDER}`,
                fontSize: 9, color: "#3a4455",
                display: "flex", justifyContent: "space-between",
                flexShrink: 0,
            }}>
                <span>{displayed.length} line{displayed.length === 1 ? "" : "s"}</span>
                {filter !== "all" && (
                    <button
                        onClick={() => setFilter("all")}
                        style={{ background: "none", border: "none", color: DIM, fontSize: 9, cursor: "pointer", padding: 0 }}
                    >
                        Clear filter ×
                    </button>
                )}
            </div>
        </div>
    );
}
