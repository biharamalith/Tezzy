import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import {
    invokeListScreenshots,
    listenScreenshotTaken,
    ScreenshotTakenEvent,
    UnlistenFn,
} from "../../lib/tauri";

const accent = "#9D7BFF";

export default function ScreenshotPanel() {
    const [screenshots, setScreenshots] = useState<string[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        let unlisten: UnlistenFn | undefined;

        invokeListScreenshots()
            .then((paths) => setScreenshots(paths))
            .catch(() => {});

        listenScreenshotTaken((event: ScreenshotTakenEvent) => {
            setScreenshots((prev) => [
                event.path,
                ...prev.filter((p) => p !== event.path),
            ]);
            setSelected(event.path);
        }).then((stop) => { unlisten = stop; });

        return () => { unlisten?.(); };
    }, []);

    if (screenshots.length === 0) return null;

    return (
        <div style={{
            borderTop: "1px solid #1a2030",
            padding: "12px 18px 14px",
            background: "rgba(157,123,255,0.03)",
        }}>
            {/* Header */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: "10px",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <span style={{
                        fontSize: "11px", fontWeight: 700, letterSpacing: "0.6px",
                        textTransform: "uppercase", color: "#4a5568",
                    }}>
                        Screenshots
                    </span>
                    <span style={{
                        background: "rgba(157,123,255,0.15)", color: accent,
                        borderRadius: "10px", padding: "1px 7px", fontSize: "10px", fontWeight: 700,
                    }}>
                        {screenshots.length}
                    </span>
                </div>
                {selected && (
                    <button
                        onClick={() => setSelected(null)}
                        style={{
                            background: "none", border: "none", color: "#4a5568",
                            fontSize: "16px", cursor: "pointer", lineHeight: 1, padding: "0 2px",
                        }}
                        title="Close preview"
                    >
                        ×
                    </button>
                )}
            </div>

            {/* Expanded preview */}
            {selected && (
                <div style={{
                    marginBottom: "10px",
                    borderRadius: "10px", overflow: "hidden",
                    border: `1px solid ${accent}22`,
                    background: "#080b10",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    maxHeight: "320px",
                }}>
                    <img
                        ref={imgRef}
                        src={convertFileSrc(selected)}
                        alt="Screenshot"
                        style={{
                            maxWidth: "100%", maxHeight: "320px",
                            objectFit: "contain", display: "block",
                            userSelect: "none",
                        }}
                    />
                </div>
            )}

            {/* Thumbnail strip */}
            <div style={{
                display: "flex", gap: "7px",
                overflowX: "auto", paddingBottom: "2px",
            }}>
                {screenshots.map((path) => {
                    const isActive = path === selected;
                    const name = path.split(/[/\\]/).pop() ?? "screenshot";
                    return (
                        <button
                            key={path}
                            onClick={() => setSelected(isActive ? null : path)}
                            title={name}
                            style={{
                                flexShrink: 0, padding: 0,
                                border: `2px solid ${isActive ? accent : "#20252E"}`,
                                borderRadius: "7px", background: "#080b10",
                                cursor: "pointer", width: "58px", height: "58px",
                                overflow: "hidden", transition: "border-color 0.15s",
                                outline: "none",
                            }}
                        >
                            <img
                                src={convertFileSrc(path)}
                                alt={name}
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
