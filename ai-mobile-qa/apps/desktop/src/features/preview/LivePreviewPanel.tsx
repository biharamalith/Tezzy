import { useState, useEffect, DragEvent } from "react";
import {
    invokeStartScrcpy,
    invokeStopScrcpy,
    invokeGetScrcpyStatus,
    invokeInstallAndLaunchApk,
    listenScrcpyState,
    ScrcpyStateEvent,
    UnlistenFn,
} from "../../lib/tauri";

const accent = "#9D7BFF";

export default function LivePreviewPanel() {
    const [scrcpyRunning, setScrcpyRunning] = useState(false);
    const [scrcpyMessage, setScrcpyMessage] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [installing, setInstalling] = useState(false);

    useEffect(() => {
        let unlisten: UnlistenFn | undefined;

        // Listen for scrcpy state changes
        listenScrcpyState((state: ScrcpyStateEvent) => {
            setScrcpyRunning(state.status === "running");
            setScrcpyMessage(state.message ?? null);
        }).then((stop) => {
            unlisten = stop;
        });

        // Check initial status
        invokeGetScrcpyStatus().then((status) => {
            setScrcpyRunning(status.running);
        });

        return () => {
            unlisten?.();
        };
    }, []);

    const handleStartPreview = async () => {
        try {
            const result = await invokeStartScrcpy();
            setScrcpyMessage(result);
        } catch (err) {
            setScrcpyMessage(String(err));
        }
    };

    const handleStopPreview = async () => {
        try {
            const result = await invokeStopScrcpy();
            setScrcpyMessage(result);
        } catch (err) {
            setScrcpyMessage(String(err));
        }
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const apkFile = files.find((file) =>
            file.name.toLowerCase().endsWith(".apk")
        );

        if (!apkFile) {
            setScrcpyMessage("Please drop a valid .apk file");
            return;
        }

        setInstalling(true);
        setScrcpyMessage(`Installing ${apkFile.name}...`);

        try {
            // @ts-expect-error - path property exists on File in Tauri context
            const apkPath = apkFile.path;
            const result = await invokeInstallAndLaunchApk(apkPath);

            if (result.success) {
                setScrcpyMessage(
                    `✓ ${apkFile.name} installed${result.package_name ? ` (${result.package_name})` : ""}`
                );
            } else {
                setScrcpyMessage(`✗ Install failed: ${result.message}`);
            }
        } catch (err) {
            setScrcpyMessage(`✗ Error: ${String(err)}`);
        } finally {
            setInstalling(false);
        }
    };

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", gap: 0 }}
        >
            {/* APK drag overlay */}
            {isDragging && (
                <div style={{
                    position: "absolute", inset: 0, zIndex: 20,
                    background: "rgba(157,123,255,0.08)",
                    border: `2px dashed ${accent}`,
                    borderRadius: "16px",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px",
                    backdropFilter: "blur(2px)",
                }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span style={{ fontSize: "15px", fontWeight: 600, color: accent }}>Drop APK to install</span>
                </div>
            )}

            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: "8px",
                        background: "rgba(157,123,255,0.12)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                        </svg>
                    </div>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "#E6EDF3", letterSpacing: "-0.2px" }}>Live Preview</span>
                </div>

                {/* Status pill */}
                <div style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "4px 10px", borderRadius: "20px",
                    background: scrcpyRunning ? "rgba(63,185,80,0.1)" : "rgba(139,148,158,0.08)",
                    border: `1px solid ${scrcpyRunning ? "rgba(63,185,80,0.25)" : "#20252E"}`,
                    fontSize: "11px", fontWeight: 600,
                    color: scrcpyRunning ? "#3FB950" : "#6E7681",
                }}>
                    <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: scrcpyRunning ? "#3FB950" : "#6E7681",
                        boxShadow: scrcpyRunning ? "0 0 6px #3FB950" : "none",
                        display: "inline-block",
                    }}/>
                    {scrcpyRunning ? "Mirroring" : "Idle"}
                </div>
            </div>

            {/* Phone visual frame */}
            <div style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: "20px", minHeight: "120px",
            }}>
                {scrcpyRunning ? (
                    <div style={{ textAlign: "center" }}>
                        {/* Animated phone with signal lines */}
                        <div style={{ position: "relative", display: "inline-block" }}>
                            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
                                <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2"/>
                                <rect x="8" y="6" width="8" height="8" rx="1" fill="rgba(157,123,255,0.15)" stroke="rgba(157,123,255,0.4)"/>
                            </svg>
                            <div style={{
                                position: "absolute", top: -3, right: -3,
                                width: 12, height: 12, borderRadius: "50%",
                                background: "#3FB950", border: "2px solid #0D1117",
                                boxShadow: "0 0 8px #3FB950",
                            }}/>
                        </div>
                        <div style={{ marginTop: "12px", fontSize: "12px", color: "#8B949E", lineHeight: 1.5 }}>
                            Screen mirroring active<br/>
                            <span style={{ color: "#6E7681", fontSize: "11px" }}>scrcpy running in separate window</span>
                        </div>
                    </div>
                ) : (
                    <div style={{ textAlign: "center" }}>
                        {/* Drop zone / idle phone */}
                        <div style={{
                            width: "120px", height: "120px", borderRadius: "16px",
                            border: "2px dashed #20252E",
                            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px",
                            margin: "0 auto",
                            background: "rgba(255,255,255,0.01)",
                            transition: "border-color 0.2s",
                        }}>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="5" y="2" width="14" height="20" rx="2"/>
                                <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2" stroke="#4a5568"/>
                            </svg>
                            <span style={{ fontSize: "10px", color: "#4a5568", fontWeight: 500 }}>No Signal</span>
                        </div>
                        <div style={{ marginTop: "10px", fontSize: "11px", color: "#4a5568" }}>
                            {installing ? "Installing APK…" : "Start preview to mirror device"}
                        </div>
                    </div>
                )}
            </div>

            {/* Status message */}
            {scrcpyMessage && (
                <div style={{
                    display: "flex", alignItems: "flex-start", gap: "8px",
                    padding: "10px 12px", borderRadius: "8px", marginBottom: "14px",
                    background: scrcpyMessage.startsWith("✗") ? "rgba(248,81,73,0.07)" : "rgba(63,185,80,0.07)",
                    border: `1px solid ${scrcpyMessage.startsWith("✗") ? "rgba(248,81,73,0.2)" : "rgba(63,185,80,0.2)"}`,
                    fontSize: "11px", lineHeight: 1.5,
                    color: scrcpyMessage.startsWith("✗") ? "#F85149" : "#8B949E",
                    wordBreak: "break-word",
                }}>
                    <span style={{ flexShrink: 0, marginTop: "1px" }}>
                        {scrcpyMessage.startsWith("✗") ? "⚠" : "ℹ"}
                    </span>
                    {scrcpyMessage}
                </div>
            )}

            {/* Action row */}
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {!scrcpyRunning ? (
                    <button
                        onClick={handleStartPreview}
                        disabled={installing}
                        style={{
                            flex: 1, border: "none", borderRadius: "10px",
                            padding: "11px 0", fontWeight: 700, fontSize: "13px",
                            cursor: installing ? "not-allowed" : "pointer",
                            background: `linear-gradient(135deg, ${accent}, #7B5CE5)`,
                            color: "#fff",
                            opacity: installing ? 0.5 : 1,
                            letterSpacing: "0.2px",
                            boxShadow: installing ? "none" : "0 4px 14px rgba(157,123,255,0.3)",
                        }}
                    >
                        ▶  Start Preview
                    </button>
                ) : (
                    <button
                        onClick={handleStopPreview}
                        disabled={installing}
                        style={{
                            flex: 1, border: "1px solid rgba(248,81,73,0.3)", borderRadius: "10px",
                            padding: "11px 0", fontWeight: 700, fontSize: "13px",
                            cursor: installing ? "not-allowed" : "pointer",
                            background: "rgba(248,81,73,0.12)",
                            color: "#F85149",
                            opacity: installing ? 0.5 : 1,
                            letterSpacing: "0.2px",
                        }}
                    >
                        ■  Stop Preview
                    </button>
                )}

                {/* APK hint badge */}
                <div style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "9px 12px", borderRadius: "10px",
                    border: "1px dashed #20252E",
                    color: "#4a5568", fontSize: "11px", fontWeight: 500,
                    cursor: "default", userSelect: "none",
                    whiteSpace: "nowrap",
                }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Drop APK
                </div>
            </div>
        </div>
    );
}
