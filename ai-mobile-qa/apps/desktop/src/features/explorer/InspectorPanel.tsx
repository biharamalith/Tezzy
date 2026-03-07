import { useState, useEffect } from "react";
import { invokeActionTap, invokeGetUiHierarchy, UiElement } from "../../lib/tauri";

const accent = "#9D7BFF";

// Map Android class names to friendly icons + short labels
function classIcon(cls: string): string {
    if (cls.includes("Button") || cls.includes("Chip")) return "⬜";
    if (cls.includes("EditText")) return "✎";
    if (cls.includes("TextView")) return "T";
    if (cls.includes("ImageView") || cls.includes("ImageButton")) return "⊡";
    if (cls.includes("CheckBox") || cls.includes("RadioButton")) return "◉";
    if (cls.includes("Switch") || cls.includes("Toggle")) return "⇌";
    if (cls.includes("RecyclerView") || cls.includes("ListView") || cls.includes("ScrollView")) return "≡";
    if (cls.includes("FrameLayout") || cls.includes("LinearLayout") || cls.includes("RelativeLayout") || cls.includes("ConstraintLayout")) return "▭";
    return "◇";
}

function classColor(cls: string): string {
    if (cls.includes("Button") || cls.includes("Chip")) return "#7B5CE5";
    if (cls.includes("EditText")) return "#E3B341";
    if (cls.includes("TextView")) return "#8B949E";
    if (cls.includes("ImageView") || cls.includes("ImageButton")) return "#3FB950";
    if (cls.includes("CheckBox") || cls.includes("RadioButton") || cls.includes("Switch")) return "#58A6FF";
    if (cls.includes("RecyclerView") || cls.includes("ListView") || cls.includes("ScrollView")) return "#F78166";
    return "#4a5568";
}

function primaryLabel(el: UiElement): string {
    if (el.text) return el.text;
    if (el.content_desc) return el.content_desc;
    if (el.resource_id) {
        // Strip package prefix: "com.app:id/login_button" → "login_button"
        const parts = el.resource_id.split("/");
        return parts[parts.length - 1];
    }
    return el.class;
}

type Props = {
    serial?: string | null;
    onTap?: (x: number, y: number) => void;
};

export default function InspectorPanel({ serial, onTap }: Props) {
    const [elements, setElements] = useState<UiElement[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<"all" | "clickable">("clickable");
    const [tapping, setTapping] = useState<number | null>(null); // index being tapped

    // Clear hierarchy when device changes
    useEffect(() => {
        setElements([]);
        setError(null);
    }, [serial]);

    const dump = async () => {
        setLoading(true);
        setError(null);
        try {
            const els = await invokeGetUiHierarchy();
            setElements(els);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    const tap = async (el: UiElement, idx: number) => {
        setTapping(idx);
        try {
            await invokeActionTap(el.center_x, el.center_y);
            onTap?.(el.center_x, el.center_y);
        } catch (err) {
            console.error(err);
        } finally {
            setTapping(null);
        }
    };

    const filtered = filter === "clickable"
        ? elements.filter(el => el.clickable || el.scrollable || el.checkable)
        : elements;

    const sectionLabel: React.CSSProperties = {
        fontSize: "11px", fontWeight: 700, letterSpacing: "0.6px",
        textTransform: "uppercase", color: "#4a5568",
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
            {/* Header */}
            <div style={{
                padding: "14px 16px 10px",
                borderBottom: "1px solid #1a2030",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexShrink: 0,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{
                        width: 26, height: 26, borderRadius: "7px",
                        background: "rgba(157,123,255,0.12)",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                        </svg>
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#E6EDF3" }}>UI Inspector</span>
                    {elements.length > 0 && (
                        <span style={{
                            background: "rgba(157,123,255,0.15)", color: accent,
                            borderRadius: "10px", padding: "1px 7px", fontSize: "10px", fontWeight: 700,
                        }}>{filtered.length}</span>
                    )}
                </div>

                <button
                    onClick={dump}
                    disabled={loading}
                    style={{
                        border: `1px solid ${accent}44`,
                        borderRadius: "8px", padding: "5px 12px",
                        background: "rgba(157,123,255,0.08)",
                        color: loading ? "#4a5568" : accent,
                        fontSize: "11px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: "5px",
                        transition: "opacity 0.15s",
                    }}
                >
                    {loading ? (
                        <>
                            <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
                            Dumping...
                        </>
                    ) : (
                        <>⟳ Dump UI</>
                    )}
                </button>
            </div>

            {/* Filter bar */}
            {elements.length > 0 && (
                <div style={{
                    padding: "8px 16px",
                    borderBottom: "1px solid #1a2030",
                    display: "flex", alignItems: "center", gap: "6px",
                    flexShrink: 0,
                }}>
                    <span style={sectionLabel}>Show:</span>
                    {(["clickable", "all"] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            style={{
                                padding: "3px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: 700,
                                cursor: "pointer", letterSpacing: "0.3px",
                                border: `1px solid ${filter === f ? accent + "55" : "#1e2530"}`,
                                background: filter === f ? "rgba(157,123,255,0.12)" : "transparent",
                                color: filter === f ? accent : "#6E7681",
                            }}
                        >
                            {f === "clickable" ? "Interactive" : "All"}
                        </button>
                    ))}
                    <span style={{ marginLeft: "auto", fontSize: "10px", color: "#4a5568" }}>
                        {filtered.length} / {elements.length}
                    </span>
                </div>
            )}

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
                {error && (
                    <div style={{
                        margin: "8px", padding: "10px 12px", borderRadius: "8px",
                        background: "rgba(248,81,73,0.07)", border: "1px solid rgba(248,81,73,0.2)",
                        fontSize: "11px", color: "#F85149", lineHeight: 1.6,
                    }}>
                        {error}
                    </div>
                )}

                {!loading && elements.length === 0 && !error && (
                    <div style={{ padding: "32px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: "28px", marginBottom: "10px", opacity: 0.3 }}>⊞</div>
                        <div style={{ fontSize: "12px", color: "#4a5568", lineHeight: 1.7 }}>
                            Click <strong style={{ color: accent }}>Dump UI</strong> to inspect<br />
                            the current screen elements
                        </div>
                    </div>
                )}

                {filtered.map((el, idx) => {
                    const label = primaryLabel(el);
                    const icon = classIcon(el.class);
                    const color = classColor(el.class);
                    const indent = Math.min(el.depth, 5) * 10;
                    const isTapping = tapping === idx;

                    return (
                        <div
                            key={idx}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "5px 8px",
                                marginLeft: `${indent}px`,
                                borderRadius: "8px",
                                marginBottom: "2px",
                                background: "transparent",
                                transition: "background 0.1s",
                                cursor: "default",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#0F1520")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                            {/* Type badge */}
                            <span style={{
                                flexShrink: 0,
                                width: 22, height: 22,
                                borderRadius: "5px",
                                background: color + "18",
                                border: `1px solid ${color}30`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: "11px", color,
                            }}>
                                {icon}
                            </span>

                            {/* Label + meta */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: "11px", fontWeight: 600,
                                    color: el.clickable ? "#C9D1D9" : "#6E7681",
                                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                }}>
                                    {label || <span style={{ color: "#3a4050", fontStyle: "italic" }}>unlabeled</span>}
                                </div>
                                <div style={{
                                    fontSize: "9px", color: "#4a5568",
                                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                }}>
                                    {el.class}
                                    {el.scrollable && <span style={{ color: "#58A6FF99", marginLeft: 4 }}>scroll</span>}
                                    {el.checkable && <span style={{ color: "#58A6FF99", marginLeft: 4 }}>{el.checked ? "✓" : "☐"}</span>}
                                    <span style={{ marginLeft: 5, color: "#2a3040" }}>
                                        ({el.center_x},{el.center_y})
                                    </span>
                                </div>
                            </div>

                            {/* Tap button */}
                            {(el.clickable || el.scrollable || el.checkable) && (
                                <button
                                    onClick={() => tap(el, idx)}
                                    disabled={isTapping}
                                    style={{
                                        flexShrink: 0,
                                        border: `1px solid ${accent}33`,
                                        borderRadius: "6px",
                                        padding: "3px 9px",
                                        background: isTapping ? "rgba(157,123,255,0.2)" : "rgba(157,123,255,0.08)",
                                        color: accent,
                                        fontSize: "10px", fontWeight: 700,
                                        cursor: isTapping ? "not-allowed" : "pointer",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isTapping ? "..." : "Tap"}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
