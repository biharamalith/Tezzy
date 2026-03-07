import { useEffect, useState } from "react";

import { LogEvent, listenLog } from "../../lib/tauri";

type LogLine = LogEvent;

const MAX_LINES = 2000;

export default function TerminalLogPanel() {
    const [lines, setLines] = useState<LogLine[]>([]);

    useEffect(() => {
        let unlisten: (() => void) | undefined;

        listenLog((event) => {
            // Keep only the newest MAX_LINES lines to bound memory usage.
            setLines((prev) => {
                const next = [...prev, event];
                return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
            });
        }).then((stop) => {
            unlisten = stop;
        });

        return () => {
            unlisten?.();
        };
    }, []);

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div
                style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid #20252E",
                    color: "#9D7BFF",
                    fontWeight: 600,
                    fontSize: "13px",
                }}
            >
                System Log
            </div>
            <div
                style={{
                    flex: 1,
                    overflowY: "auto",
                    fontFamily: "Consolas, 'Courier New', monospace",
                    fontSize: "12px",
                    color: "#C9D1D9",
                    padding: "12px 16px",
                }}
            >
                {lines.length === 0 ? (
                    <div style={{ color: "#8B949E" }}>Waiting for events...</div>
                ) : (
                    lines.map((line, index) => (
                        <div key={`${line.ts}-${index}`} style={{ marginBottom: "6px" }}>
                            <span style={{ color: "#6E7681" }}>
                                {new Date(line.ts).toLocaleTimeString()}
                            </span>
                            <span
                                style={{
                                    color:
                                        line.level === "error"
                                            ? "#FF7B72"
                                            : line.level === "warn"
                                            ? "#D29922"
                                            : "#C9D1D9",
                                }}
                            >
                                [{line.level.toUpperCase()}]
                            </span>
                            <span style={{ marginLeft: "8px" }}>{line.message}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
