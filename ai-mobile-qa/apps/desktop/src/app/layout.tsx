import { useEffect, useState } from "react";

import DeviceSelector from "../features/devices/DeviceSelector";
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
    UnlistenFn,
    invokeEnvCheck,
    invokeListDevices,
    invokeSetActiveDevice,
    listenDeviceState,
} from "../lib/tauri";

const background = "#0D1117";
const accent = "#9D7BFF";

type RightTab = "log" | "inspector";

export default function Layout() {
    const [devices, setDevices] = useState<Device[]>([]);
    const [activeSerial, setActiveSerial] = useState<string | null>(null);
    const [adbStatus, setAdbStatus] = useState<string>("Checking...");
    const [adbAvailable, setAdbAvailable] = useState<boolean>(false);
    const [rightTab, setRightTab] = useState<RightTab>("log");
    const [prefillTap, setPrefillTap] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
        let unlisten: UnlistenFn | undefined;

        // Device state is emitted by Rust after refresh and selection.
        listenDeviceState((state: DeviceState) => {
            setDevices(state.devices);
            setActiveSerial(state.activeSerial);
        }).then((stop) => {
            unlisten = stop;
        });

        return () => {
            unlisten?.();
        };
    }, []);

    useEffect(() => {
        invokeEnvCheck()
            .then((status: EnvStatus) => {
                if (status.adb_available) {
                    setAdbStatus(status.version ?? "adb detected");
                    setAdbAvailable(true);
                } else {
                    setAdbStatus("adb missing");
                    setAdbAvailable(false);
                }
            })
            .catch(() => {
                setAdbStatus("adb check failed");
                setAdbAvailable(false);
            });
    }, []);

    const refreshDevices = async () => {
        const latest = await invokeListDevices();
        setDevices(latest);
    };

    const handleSelect = async (serial: string) => {
        await invokeSetActiveDevice(serial);
        setActiveSerial(serial);
    };

    return (
        <div
            style={{
                background,
                color: "#E6EDF3",
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                fontFamily: '"Segoe UI", "Tahoma", sans-serif',
                overflow: "hidden",
            }}
        >
            <header
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 24px",
                    borderBottom: "1px solid #20252E",
                }}
            >
                <div style={{ fontSize: "20px", fontWeight: 600, color: accent }}>Tezzy</div>
                <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#8B949E" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span
                            style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: adbAvailable ? "#3FB950" : "#F85149",
                                boxShadow: adbAvailable
                                    ? "0 0 6px #3FB950"
                                    : "0 0 6px #F85149",
                            }}
                        />
                        <span style={{ color: adbAvailable ? "#3FB950" : "#F85149" }}>
                            ADB: {adbStatus}
                        </span>
                    </span>
                    <span>Active: {activeSerial ?? "None"}</span>
                </div>
            </header>

            <main
                style={{
                    flex: 1,
                    display: "grid",
                    gridTemplateColumns: "260px 1fr 360px",
                    gap: "16px",
                    padding: "16px",
                    overflow: "hidden",
                    minHeight: 0,
                }}
            >
                <section
                    style={{
                        border: "1px solid #20252E",
                        borderRadius: "12px",
                        padding: "16px",
                        background: "#0F141B",
                    }}
                >
                    <DeviceSelector
                        devices={devices}
                        activeSerial={activeSerial}
                        onRefresh={refreshDevices}
                        onSelect={handleSelect}
                    />
                </section>

                <section
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        minWidth: 0,
                        minHeight: 0,
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            border: "1px solid #1a2030",
                            borderRadius: "16px",
                            padding: "22px 24px",
                            background: "linear-gradient(160deg, #0D1420 0%, #0A0E18 100%)",
                            flex: "1 1 50%",
                            minHeight: 0,
                            overflow: "hidden",
                        }}
                    >
                        <LivePreviewPanel />
                    </div>
                    <div
                        style={{
                            border: "1px solid #1a2030",
                            borderRadius: "14px",
                            background: "#0A0D14",
                            flex: "0 1 auto",
                            minHeight: 0,
                            overflow: "auto",
                            maxHeight: "45%",
                        }}
                    >
                        <SessionPanel
                            prefillTap={prefillTap}
                            onPrefillConsumed={() => setPrefillTap(null)}
                        />
                    </div>
                    {/* Auto Smoke Check panel */}
                    <div
                        style={{
                            flex: "0 0 auto",
                        }}
                    >
                        <SmokeCheckPanel />
                    </div>
                    {/* Screenshot gallery — appears automatically when screenshots are taken */}
                    <div
                        style={{
                            border: "1px solid #1a2030",
                            borderRadius: "14px",
                            background: "#0A0D14",
                            flex: "0 0 auto",
                            overflow: "hidden",
                        }}
                    >
                        <ScreenshotPanel />
                    </div>
                </section>

                <section
                    style={{
                        border: "1px solid #20252E",
                        borderRadius: "12px",
                        background: "#0B0F15",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                        overflow: "hidden",
                    }}
                >
                    {/* Tab bar */}
                    <div style={{
                        display: "flex",
                        borderBottom: "1px solid #20252E",
                        padding: "0 4px",
                        flexShrink: 0,
                    }}>
                        {(["log", "inspector"] as RightTab[]).map((tab) => {
                            const labels: Record<RightTab, string> = {
                                log: "System Log",
                                inspector: "UI Inspector",
                            };
                            const active = rightTab === tab;
                            return (
                                <button
                                    key={tab}
                                    onClick={() => setRightTab(tab)}
                                    style={{
                                        flex: 1,
                                        padding: "10px 0",
                                        background: "none",
                                        border: "none",
                                        borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
                                        color: active ? accent : "#6E7681",
                                        fontSize: "11px",
                                        fontWeight: active ? 700 : 500,
                                        cursor: "pointer",
                                        letterSpacing: "0.4px",
                                        transition: "color 0.15s, border-color 0.15s",
                                        marginBottom: "-1px",
                                    }}
                                >
                                    {labels[tab]}
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
                                onTap={(x, y) => {
                                    setPrefillTap({ x, y });
                                }}
                            />
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}
