import type { ChangeEvent } from "react";

import { Device } from "../../lib/tauri";

type DeviceSelectorProps = {
    devices: Device[];
    activeSerial: string | null;
    onRefresh: () => void;
    onSelect: (serial: string) => void;
};

export default function DeviceSelector({
    devices,
    activeSerial,
    onRefresh,
    onSelect,
}: DeviceSelectorProps) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#E6EDF3" }}>
                Devices
            </div>
            <button
                onClick={onRefresh}
                style={{
                    background: "#1F2430",
                    border: "1px solid #30363D",
                    color: "#E6EDF3",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    cursor: "pointer",
                }}
            >
                Refresh devices
            </button>
            <select
                value={activeSerial ?? ""}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    onSelect(event.target.value)
                }
                style={{
                    background: "#0B0F15",
                    border: "1px solid #30363D",
                    color: "#E6EDF3",
                    padding: "8px 12px",
                    borderRadius: "8px",
                }}
                disabled={devices.length === 0}
            >
                <option value="" disabled>
                    {devices.length === 0 ? "No devices detected" : "Select a device"}
                </option>
                {devices.map((device) => (
                    <option key={device.serial} value={device.serial}>
                        {device.serial} ({device.state})
                    </option>
                ))}
            </select>
            <div style={{ fontSize: "12px", color: "#8B949E" }}>
                {devices.length} device{devices.length === 1 ? "" : "s"} detected
            </div>
        </div>
    );
}
