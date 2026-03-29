import { useEffect, useState } from "react";

import LivePreviewPanel from "../features/preview/LivePreviewPanel";
import TerminalLogPanel from "../features/logs/TerminalLogPanel";
import SessionPanel from "../features/sessions/SessionPanel";
import ScreenshotPanel from "../features/reports/ScreenshotPanel";
import InspectorPanel from "../features/explorer/InspectorPanel";
import SmokeCheckPanel from "../features/sessions/SmokeCheckPanel";
import {
    Device,
    DeviceState,
    EnvStatus,
    UiElement,
    UnlistenFn,
    invokeEnvCheck,
    invokeGetUiSnapshot,
    invokeListDevices,
    invokeSetActiveDevice,
    listenDeviceState,
} from "../lib/tauri";

// ── Design tokens ──────────────────────────────────────────────────────────────
const BG        = "#0D1117";
const SURFACE   = "#080C12";
const CARD      = "#0F1420";
const ACCENT    = "#9D7BFF";
const SUCCESS   = "#3FB950";
const ERR       = "#F85149";
const WARN      = "#E3B341";
const BORDER    = "#1C2333";
const TEXT      = "#E6EDF3";
const MUTED     = "#8B949E";
const DIM       = "#6E7681";
const GHOST     = "#4a5568";

// ── Types ──────────────────────────────────────────────────────────────────────
type CenterTab = "preview" | "automation" | "smokecheck" | "inspector";
type RightTab  = "log" | "inspector";

const NAV: { id: CenterTab; label: string; dot: string }[] = [
    { id: "preview",    label: "Live Preview", dot: ACCENT   },
    { id: "automation", label: "Automation",   dot: SUCCESS  },
    { id: "smokecheck", label: "Smoke Check",  dot: WARN     },
    { id: "inspector",  label: "Inspector",    dot: "#58A6FF" },
];

type StoredInspectorScreen = {
    elements: UiElement[];
    saved_at: number;
};

const INSPECTOR_CACHE_KEY = "tezzy:inspector:screen_cache:v1";
const INSPECTOR_BOOKMARK_KEY = "tezzy:inspector:last_bookmark:v1";
const MAX_INSPECTOR_CACHE_SCREENS = 40;

function readStorageJson<T>(key: string, fallback: T): T {
    if (typeof window === "undefined") return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function trimInspectorCache(
    cache: Record<string, StoredInspectorScreen>,
): Record<string, StoredInspectorScreen> {
    const entries = Object.entries(cache).sort((a, b) => b[1].saved_at - a[1].saved_at);
    return Object.fromEntries(entries.slice(0, MAX_INSPECTOR_CACHE_SCREENS));
}

// ── Tiny shared components ─────────────────────────────────────────────────────
function Dot({ color, glow }: { color: string; glow?: boolean }) {
    return (
        <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: color, flexShrink: 0, display: "inline-block",
            boxShadow: glow ? `0 0 7px ${color}` : "none",
        }} />
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.8px",
            textTransform: "uppercase", color: GHOST,
            padding: "14px 16px 6px",
        }}>
            {children}
        </div>
    );
}

// Phone SVG
function PhoneIcon({ color = ACCENT }: { color?: string }) {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
    );
}
// Play-circle SVG
function PlayIcon({ color = ACCENT }: { color?: string }) {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
        </svg>
    );
}
// Activity SVG
function ActivityIcon({ color = ACCENT }: { color?: string }) {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
    );
}
// Inspector grid SVG
function GridIcon({ color = ACCENT }: { color?: string }) {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
    );
}

function navIcon(id: CenterTab, color: string) {
    if (id === "preview")    return <PhoneIcon color={color} />;
    if (id === "automation") return <PlayIcon color={color} />;
    if (id === "smokecheck") return <ActivityIcon color={color} />;
    return <GridIcon color={color} />;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Layout() {
    const [devices,          setDevices]          = useState<Device[]>([]);
    const [activeSerial,     setActiveSerial]     = useState<string | null>(null);
    const [adbStatus,        setAdbStatus]        = useState<string>("Checking...");
    const [adbOk,            setAdbOk]            = useState(false);
    const [rightTab,         setRightTab]         = useState<RightTab>("log");
    const [centerTab,        setCenterTab]        = useState<CenterTab>("preview");
    const [prefillTap,       setPrefillTap]       = useState<{ x: number; y: number } | null>(null);
    const [narrow,           setNarrow]           = useState(window.innerWidth < 780);

    // ── Shared inspector state (both panels stay in sync) ──────────────────
    const [inspectorElements, setInspectorElements] = useState<UiElement[]>([]);
    const [inspectorLoading,  setInspectorLoading]  = useState(false);
    const [inspectorError,    setInspectorError]    = useState<string | null>(null);
    const [inspectorScreenHash, setInspectorScreenHash] = useState<string | null>(null);
    const [inspectorScreenCache, setInspectorScreenCache] = useState<Record<string, StoredInspectorScreen>>(
        () => readStorageJson<Record<string, StoredInspectorScreen>>(INSPECTOR_CACHE_KEY, {}),
    );
    const [inspectorBookmarkHash, setInspectorBookmarkHash] = useState<string | null>(
        () => readStorageJson<string | null>(INSPECTOR_BOOKMARK_KEY, null),
    );

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(INSPECTOR_CACHE_KEY, JSON.stringify(inspectorScreenCache));
        } catch {
            // Ignore local storage write issues and keep runtime state only.
        }
    }, [inspectorScreenCache]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            if (inspectorBookmarkHash) {
                window.localStorage.setItem(INSPECTOR_BOOKMARK_KEY, JSON.stringify(inspectorBookmarkHash));
            } else {
                window.localStorage.removeItem(INSPECTOR_BOOKMARK_KEY);
            }
        } catch {
            // Ignore local storage write issues and keep runtime state only.
        }
    }, [inspectorBookmarkHash]);

    const dumpInspector = async () => {
        setInspectorLoading(true);
        setInspectorError(null);
        try {
            const snap = await invokeGetUiSnapshot();
            const elements = snap.ui_elements ?? [];
            const screenHash = snap.screen_hash ?? null;
            setInspectorElements(elements);
            setInspectorScreenHash(screenHash);
            if (screenHash) {
                setInspectorScreenCache((prev) => {
                    const next = {
                        ...prev,
                        [screenHash]: {
                            elements,
                            saved_at: Date.now(),
                        },
                    };
                    return trimInspectorCache(next);
                });
            }
        } catch (err) {
            setInspectorError(String(err));
        } finally {
            setInspectorLoading(false);
        }
    };

    const bookmarkCurrentInspectorScreen = () => {
        if (!inspectorScreenHash) return;
        setInspectorBookmarkHash(inspectorScreenHash);
    };

    const restoreBookmarkedInspectorScreen = () => {
        if (!inspectorBookmarkHash) {
            setInspectorError("No bookmarked inspector screen found.");
            return;
        }
        const cached = inspectorScreenCache[inspectorBookmarkHash];
        if (!cached) {
            setInspectorError("Bookmarked screen is no longer cached. Dump the screen and bookmark again.");
            return;
        }
        setInspectorError(null);
        setInspectorElements(cached.elements);
        setInspectorScreenHash(inspectorBookmarkHash);
    };

    // Responsive sidebar collapse
    useEffect(() => {
        const handler = () => setNarrow(window.innerWidth < 780);
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
    }, []);

    // Device state listener
    useEffect(() => {
        let unlisten: UnlistenFn | undefined;
        listenDeviceState((state: DeviceState) => {
            setDevices(state.devices);
            setActiveSerial(state.activeSerial);
        }).then((stop) => { unlisten = stop; });
        return () => { unlisten?.(); };
    }, []);

    // ADB env check
    useEffect(() => {
        invokeEnvCheck()
            .then((status: EnvStatus) => {
                setAdbOk(status.adb_available);
                setAdbStatus(status.adb_available ? (status.version ?? "detected") : "missing");
            })
            .catch(() => { setAdbOk(false); setAdbStatus("error"); });
    }, []);

    const refreshDevices = async () => {
        const latest = await invokeListDevices();
        setDevices(latest);
    };

    const handleSelect = async (serial: string) => {
        await invokeSetActiveDevice(serial);
        setActiveSerial(serial);
        setInspectorScreenHash(null);
    };

    const handleTabClick = (tab: CenterTab) => {
        setCenterTab(tab);
        // Do NOT force rightTab to "inspector" — let the user control the right panel independently.
        // Previously this caused two independent InspectorPanel instances with separate state.
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div style={{
            background: BG, color: TEXT, height: "100vh",
            display: "flex", flexDirection: "column",
            fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
            overflow: "hidden",
        }}>
            {/* ── HEADER ──────────────────────────────────────────────────────── */}
            <header style={{
                height: 46, flexShrink: 0,
                background: SURFACE, borderBottom: `1px solid ${BORDER}`,
                display: "flex", alignItems: "center", padding: "0 16px", gap: 12,
            }}>
                {/* Logo */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: narrow ? 0 : 200, flexShrink: 0 }}>
                    <div style={{
                        width: 30, height: 30, borderRadius: 9,
                        background: `linear-gradient(135deg, ${ACCENT} 0%, #5B3FD4 100%)`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: `0 2px 12px rgba(157,123,255,0.45)`,
                        flexShrink: 0,
                    }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff"
                            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                    </div>
                    {!narrow && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: "-0.3px" }}>Tezzy</span>
                            <span style={{ fontSize: 9, fontWeight: 600, color: GHOST, background: BORDER, borderRadius: 4, padding: "1px 5px" }}>
                                v0.1.0
                            </span>
                        </div>
                    )}
                </div>

                {/* Center tab nav */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 2 }}>
                    {NAV.map((item) => {
                        const active = centerTab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => handleTabClick(item.id)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "5px 12px", borderRadius: 7, border: "none",
                                    background: active ? "rgba(157,123,255,0.13)" : "transparent",
                                    color: active ? TEXT : DIM,
                                    fontSize: 12, fontWeight: active ? 600 : 500,
                                    cursor: "pointer",
                                    transition: "all 0.15s",
                                    outline: "none",
                                }}
                            >
                                <span style={{
                                    width: 7, height: 7, borderRadius: "50%",
                                    background: item.dot, display: "inline-block",
                                    boxShadow: active ? `0 0 6px ${item.dot}` : "none",
                                    transition: "box-shadow 0.15s",
                                }} />
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                {/* ADB + Active device */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: MUTED, flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <Dot color={adbOk ? SUCCESS : ERR} glow={adbOk} />
                        <span style={{ color: adbOk ? SUCCESS : ERR, fontWeight: 600 }}>ADB {adbStatus}</span>
                    </div>
                    <span style={{ color: BORDER }}>·</span>
                    <span>Active: {activeSerial ?? "None"}</span>
                </div>
            </header>

            {/* ── BODY ────────────────────────────────────────────────────────── */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

                {/* SIDEBAR */}
                {!narrow && (
                    <aside style={{
                        width: 220, flexShrink: 0,
                        background: SURFACE, borderRight: `1px solid ${BORDER}`,
                        display: "flex", flexDirection: "column",
                        overflow: "hidden",
                    }}>
                        {/* ─ EXPLORER ─ */}
                        <SectionLabel>Explorer</SectionLabel>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                            {NAV.map((item) => {
                                const active = centerTab === item.id;
                                const ic = active ? item.dot : DIM;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => handleTabClick(item.id)}
                                        style={{
                                            display: "flex", alignItems: "center", gap: 9,
                                            padding: "7px 16px",
                                            borderTop: "none", borderRight: "none", borderBottom: "none",
                                            borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
                                            background: active ? "rgba(157,123,255,0.09)" : "transparent",
                                            color: active ? TEXT : DIM,
                                            fontSize: 12, fontWeight: active ? 600 : 400,
                                            cursor: "pointer", textAlign: "left",
                                            width: "100%",
                                            transition: "all 0.12s",
                                            outline: "none",
                                        }}
                                    >
                                        {navIcon(item.id, ic)}
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>

                        <div style={{ height: 1, background: BORDER, margin: "8px 16px" }} />

                        {/* ─ DEVICES ─ */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 6px" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: GHOST }}>
                                Devices
                            </span>
                            <button
                                onClick={refreshDevices}
                                title="Refresh device list"
                                style={{
                                    display: "flex", alignItems: "center", gap: 4,
                                    background: "none", border: `1px solid ${BORDER}`,
                                    borderRadius: 5, color: MUTED,
                                    fontSize: 10, padding: "2px 7px", cursor: "pointer",
                                    outline: "none",
                                }}
                            >
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                                </svg>
                                Refresh
                            </button>
                        </div>
                        <div style={{ padding: "0 16px 4px" }}>
                            <select
                                value={activeSerial ?? ""}
                                onChange={(e) => handleSelect(e.target.value)}
                                disabled={devices.length === 0}
                                style={{
                                    width: "100%",
                                    background: "#0B0F15", border: `1px solid ${BORDER}`,
                                    color: devices.length === 0 ? GHOST : TEXT,
                                    padding: "6px 8px", borderRadius: 6,
                                    fontSize: 11, outline: "none", cursor: devices.length > 0 ? "pointer" : "default",
                                }}
                            >
                                <option value="" disabled>
                                    {devices.length === 0 ? "No devices detected" : "Select a device"}
                                </option>
                                {devices.map((d) => (
                                    <option key={d.serial} value={d.serial}>{d.serial} ({d.state})</option>
                                ))}
                            </select>
                            <div style={{ fontSize: 10, color: GHOST, marginTop: 5 }}>
                                {devices.length} device{devices.length === 1 ? "" : "s"}
                                {activeSerial ? ` · ${activeSerial.substring(0, 12)}` : " · no active"}
                            </div>
                        </div>

                        <div style={{ height: 1, background: BORDER, margin: "8px 16px" }} />

                        {/* ─ ENVIRONMENT ─ */}
                        <SectionLabel>Environment</SectionLabel>
                        <div style={{ padding: "0 16px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{
                                display: "flex", alignItems: "center", gap: 7,
                                padding: "5px 9px", borderRadius: 6,
                                background: "rgba(255,255,255,0.025)",
                                border: `1px solid ${BORDER}`,
                            }}>
                                <Dot color={adbOk ? SUCCESS : ERR} glow={adbOk} />
                                <span style={{ flex: 1, fontSize: 11, color: MUTED }}>adb</span>
                                <span style={{ fontSize: 10, color: DIM, fontFamily: "monospace" }}>
                                    {adbOk ? adbStatus : "–"}
                                </span>
                                <span style={{
                                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                                    background: adbOk ? "rgba(63,185,80,0.12)" : "rgba(248,81,73,0.12)",
                                    color: adbOk ? SUCCESS : ERR, letterSpacing: "0.3px",
                                }}>
                                    {adbOk ? "OK" : "MISS"}
                                </span>
                            </div>
                        </div>

                        <div style={{ flex: 1 }} />
                    </aside>
                )}

                {/* CENTER CONTENT */}
                <main style={{
                    flex: 1, minWidth: 0,
                    display: "flex", flexDirection: "column",
                    overflow: "hidden", background: BG,
                }}>
                    {/* Live Preview tab */}
                    <div style={{
                        display: centerTab === "preview" ? "flex" : "none",
                        flexDirection: "column", flex: 1,
                        overflow: "auto", padding: 16, gap: 12,
                    }}>
                        <div style={{
                            background: CARD,
                            border: `1px solid ${BORDER}`,
                            borderRadius: 14, padding: "22px 24px",
                            flexShrink: 0,
                        }}>
                            <LivePreviewPanel />
                        </div>
                        <div style={{ flexShrink: 0 }}>
                            <ScreenshotPanel />
                        </div>
                    </div>

                    {/* Automation tab */}
                    <div style={{
                        display: centerTab === "automation" ? "flex" : "none",
                        flexDirection: "column", flex: 1,
                        overflow: "auto", padding: 16, gap: 12,
                    }}>
                        <div style={{
                            background: CARD,
                            border: `1px solid ${BORDER}`,
                            borderRadius: 14, flexShrink: 0, overflow: "hidden",
                        }}>
                            <SessionPanel
                                prefillTap={prefillTap}
                                onPrefillConsumed={() => setPrefillTap(null)}
                            />
                        </div>
                        <div style={{ flexShrink: 0 }}>
                            <ScreenshotPanel />
                        </div>
                    </div>

                    {/* Smoke Check tab */}
                    <div style={{
                        display: centerTab === "smokecheck" ? "flex" : "none",
                        flexDirection: "column", flex: 1,
                        overflow: "auto", padding: 16, gap: 12,
                    }}>
                        <div style={{ flexShrink: 0 }}>
                            <SmokeCheckPanel />
                        </div>
                        <div style={{ flexShrink: 0 }}>
                            <ScreenshotPanel />
                        </div>
                    </div>

                    {/* Inspector tab */}
                    <div style={{
                        display: centerTab === "inspector" ? "flex" : "none",
                        flexDirection: "column", flex: 1,
                        overflow: "hidden", padding: 16,
                    }}>
                        <div style={{
                            flex: 1, background: CARD,
                            border: `1px solid ${BORDER}`,
                            borderRadius: 14, overflow: "hidden",
                            display: "flex", flexDirection: "column",
                        }}>
                            <InspectorPanel
                                serial={activeSerial}
                                elements={inspectorElements}
                                loading={inspectorLoading}
                                error={inspectorError}
                                screenHash={inspectorScreenHash}
                                bookmarkedScreenHash={inspectorBookmarkHash}
                                canRestoreBookmark={Boolean(inspectorBookmarkHash && inspectorScreenCache[inspectorBookmarkHash])}
                                onDump={dumpInspector}
                                onBookmarkCurrent={bookmarkCurrentInspectorScreen}
                                onRestoreBookmark={restoreBookmarkedInspectorScreen}
                                onTap={(x, y) => {
                                    setPrefillTap({ x, y });
                                    setCenterTab("automation");
                                }}
                            />
                        </div>
                    </div>
                </main>

                {/* RIGHT PANEL */}
                <aside style={{
                    width: narrow ? 260 : 300, flexShrink: 0,
                    background: SURFACE, borderLeft: `1px solid ${BORDER}`,
                    display: "flex", flexDirection: "column",
                    overflow: "hidden",
                }}>
                    {/* Tab bar */}
                    <div style={{
                        display: "flex", borderBottom: `1px solid ${BORDER}`,
                        flexShrink: 0,
                    }}>
                        {(["log", "inspector"] as RightTab[]).map((tab) => {
                            const label = tab === "log" ? "System Log" : "UI Inspector";
                            const active = rightTab === tab;
                            return (
                                <button
                                    key={tab}
                                    onClick={() => setRightTab(tab)}
                                    style={{
                                        flex: 1, padding: "10px 0",
                                        background: "none", border: "none",
                                        borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
                                        color: active ? ACCENT : DIM,
                                        fontSize: 11, fontWeight: active ? 700 : 500,
                                        cursor: "pointer", letterSpacing: "0.4px",
                                        transition: "color 0.15s, border-color 0.15s",
                                        marginBottom: -1,
                                        outline: "none",
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Tab content */}
                    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        {rightTab === "log" && <TerminalLogPanel />}
                        {rightTab === "inspector" && (
                            <InspectorPanel
                                serial={activeSerial}
                                elements={inspectorElements}
                                loading={inspectorLoading}
                                error={inspectorError}
                                screenHash={inspectorScreenHash}
                                bookmarkedScreenHash={inspectorBookmarkHash}
                                canRestoreBookmark={Boolean(inspectorBookmarkHash && inspectorScreenCache[inspectorBookmarkHash])}
                                onDump={dumpInspector}
                                onBookmarkCurrent={bookmarkCurrentInspectorScreen}
                                onRestoreBookmark={restoreBookmarkedInspectorScreen}
                                onTap={(x, y) => {
                                    setPrefillTap({ x, y });
                                    setCenterTab("automation");
                                }}
                            />
                        )}
                    </div>
                </aside>
            </div>

            {/* STATUS BAR */}
            <footer style={{
                height: 26, flexShrink: 0,
                background: "#060A0F", borderTop: `1px solid ${BORDER}`,
                display: "flex", alignItems: "center",
                padding: "0 14px", gap: 14,
                fontSize: 10, color: GHOST, letterSpacing: "0.2px",
                userSelect: "none",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <Dot color={adbOk ? SUCCESS : ERR} />
                    <span>ADB {adbOk ? adbStatus : "–"}</span>
                </div>
                <span style={{ color: BORDER }}>·</span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <Dot color={devices.length > 0 ? SUCCESS : GHOST} />
                    <span>{devices.length} device{devices.length === 1 ? "" : "s"}</span>
                </div>
                {activeSerial && (
                    <>
                        <span style={{ color: BORDER }}>·</span>
                        <span style={{ fontFamily: "monospace", color: MUTED }}>{activeSerial}</span>
                    </>
                )}
                <div style={{ flex: 1 }} />
                <span style={{ color: BORDER }}>Tezzy v0.1.0</span>
            </footer>
        </div>
    );
}
