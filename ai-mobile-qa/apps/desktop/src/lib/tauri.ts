import { invoke } from "@tauri-apps/api/tauri";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type LogLevel = "info" | "warn" | "error" | "debug";

export type LogEvent = {
    level: LogLevel;
    message: string;
    ts: number;
};

export type Device = {
    serial: string;
    state: string;
    model?: string | null;
    product?: string | null;
    transport_id?: string | null;
};

export type DeviceStateEvent = {
    active_serial?: string | null;
    devices: Device[];
};

export type DeviceState = {
    activeSerial: string | null;
    devices: Device[];
};

export type EnvStatus = {
    adb_available: boolean;
    version?: string | null;
    message?: string | null;
};

export type ScrcpyStateEvent = {
    status: "running" | "stopped" | "error";
    message?: string | null;
    device_serial?: string | null;
};

export type ScrcpyStatus = {
    running: boolean;
    device_serial?: string | null;
};

export type InstallResult = {
    success: boolean;
    message: string;
    package_name?: string | null;
    stdout: string;
    stderr: string;
};

export type AppiumStateEvent = {
    status: "not_installed" | "installing" | "ready" | "starting" | "running" | "stopped" | "error";
    message?: string | null;
    port?: number | null;
};

export type SessionStateEvent = {
    status: "none" | "creating" | "active" | "error";
    session_id?: string | null;
    device_serial?: string | null;
    message?: string | null;
};

export type AppiumInstallInfo = {
    installed: boolean;
    appium_path: string;
    node_path: string;
};

export type AppiumServerStatus = {
    running: boolean;
    port?: number | null;
};

export async function invokeEnvCheck(): Promise<EnvStatus> {
    return invoke<EnvStatus>("env_check");
}

export async function invokeListDevices(): Promise<Device[]> {
    return invoke<Device[]>("list_devices");
}

export async function invokeSetActiveDevice(serial: string): Promise<void> {
    return invoke("set_active_device", { serial });
}

export async function listenLog(handler: (event: LogEvent) => void) {
    return listen<LogEvent>("tezzy:log", (event) => handler(event.payload));
}

export async function listenDeviceState(handler: (state: DeviceState) => void) {
    return listen<DeviceStateEvent>("tezzy:device_state", (event) => {
        handler({
            activeSerial: event.payload.active_serial ?? null,
            devices: event.payload.devices,
        });
    });
}

export async function listenScrcpyState(handler: (state: ScrcpyStateEvent) => void) {
    return listen<ScrcpyStateEvent>("tezzy:scrcpy_state", (event) => handler(event.payload));
}

export async function invokeStartScrcpy(): Promise<string> {
    return invoke<string>("start_scrcpy_preview");
}

export async function invokeStopScrcpy(): Promise<string> {
    return invoke<string>("stop_scrcpy_preview");
}

export async function invokeGetScrcpyStatus(): Promise<ScrcpyStatus> {
    return invoke<ScrcpyStatus>("get_scrcpy_preview_status");
}

export async function invokeInstallAndLaunchApk(apkPath: string): Promise<InstallResult> {
    return invoke<InstallResult>("install_and_launch_apk", { apkPath });
}

export async function listenAppiumState(handler: (state: AppiumStateEvent) => void) {
    return listen<AppiumStateEvent>("tezzy:appium_state", (event) => handler(event.payload));
}

export async function listenSessionState(handler: (state: SessionStateEvent) => void) {
    return listen<SessionStateEvent>("tezzy:session_state", (event) => handler(event.payload));
}

export async function invokeEnsureAppium(): Promise<AppiumInstallInfo> {
    return invoke<AppiumInstallInfo>("ensure_appium");
}

export async function invokeStartAppium(port?: number): Promise<string> {
    return invoke<string>("start_appium", { port });
}

export async function invokeStopAppium(): Promise<string> {
    return invoke<string>("stop_appium");
}

export async function invokeGetAppiumStatus(): Promise<AppiumServerStatus> {
    return invoke<AppiumServerStatus>("get_appium_status");
}

export async function invokeCreateSession(packageName?: string): Promise<string> {
    return invoke<string>("create_appium_session", { packageName });
}

export async function invokeDestroySession(): Promise<string> {
    return invoke<string>("destroy_appium_session");
}

export async function invokeActionTap(x: number, y: number): Promise<string> {
    return invoke<string>("action_tap", { x, y });
}

export async function invokeActionBack(): Promise<string> {
    return invoke<string>("action_back");
}

export async function invokeActionSwipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs: number
): Promise<string> {
    return invoke<string>("action_swipe", { x1, y1, x2, y2, durationMs });
}

export async function invokeActionInput(text: string): Promise<string> {
    return invoke<string>("action_input", { text });
}

export async function invokeActionScreenshot(): Promise<string> {
    return invoke<string>("action_screenshot");
}

export async function invokeListScreenshots(): Promise<string[]> {
    return invoke<string[]>("list_screenshots");
}

export type UiElement = {
    class: string;
    class_full: string;
    text: string;
    content_desc: string;
    resource_id: string;
    clickable: boolean;
    enabled: boolean;
    scrollable: boolean;
    checkable: boolean;
    checked: boolean;
    bounds: string;
    center_x: number;
    center_y: number;
    depth: number;
};

export type ScreenSize = {
    width: number;
    height: number;
};

export async function invokeGetUiHierarchy(): Promise<UiElement[]> {
    return invoke<UiElement[]>("get_ui_hierarchy");
}

export async function invokeGetDeviceScreenSize(): Promise<ScreenSize> {
    return invoke<ScreenSize>("get_device_screen_size");
}

export type UiSnapshot = {
    screen_hash: string;
    screen_size: ScreenSize;
    ui_elements: UiElement[];
};

export async function invokeGetUiSnapshot(): Promise<UiSnapshot> {
    return invoke<UiSnapshot>("get_ui_snapshot");
}

// ── Smoke Check ──────────────────────────────────────────────────────────────

export type SmokeStepRecord = {
    step_num: number;
    /** e.g. "tap:OK", "dead_tap", "no_elements", "crash" */
    action: string;
    /** "ok" | "dead_tap" | "loop" | "crash" | "stopped" */
    result_status: string;
    screenshot?: string | null;
};

export type SmokeFinding = {
    step: number;
    /** "info" | "warn" | "error" */
    severity: string;
    message: string;
};

export type SmokeCheckResult = {
    run_id: string;
    device_serial: string;
    max_steps: number;
    steps_done: number;
    /** "complete" | "stopped" | "crash" | "loop" | "no_elements" */
    final_status: string;
    findings: SmokeFinding[];
    steps: SmokeStepRecord[];
    report_path?: string | null;
};

export type AiErroredScreenRecord = {
    step: number;
    screen_hash: string;
    issue: string;
    evidence?: string[];
    screenshot?: string | null;
};

export type RunProgressEvent = {
    /** 1-based current step index */
    step: number;
    /** Total steps configured */
    total: number;
    /** e.g. "tap:OK", "dead_tap", "loop", "done" */
    action: string;
    /** "running" | "warn" | "error" | "done" | "stopped" */
    status: string;
    screenshot?: string | null;
};

export type AiVisionIssue = {
    type: string;
    description: string;
    severity: string;
    region?: string | null;
};

export type AiVisionAnalysis = {
    has_issues: boolean;
    issues: AiVisionIssue[];
    summary?: string | null;
};

export type AiVisionScreenshotResult = {
    screenshot_path: string;
    vision: AiVisionAnalysis | null;
};

export async function invokeAiVisionScreenshot(
    step: number,
    screenHash: string,
): Promise<AiVisionScreenshotResult> {
    return invoke<AiVisionScreenshotResult>("ai_vision_screenshot_cmd", {
        step,
        screenHash,
    });
}

export async function invokeRunSmokeCheck(
    maxSteps?: number,
    perStepDelayMs?: number,
): Promise<SmokeCheckResult> {
    return invoke<SmokeCheckResult>("run_smoke_check_cmd", {
        maxSteps,
        perStepDelayMs,
    });
}

export async function invokeWriteAiErroredScreensReport(
    runId: string,
    stepsDone: number,
    erroredScreens: AiErroredScreenRecord[],
): Promise<string> {
    return invoke<string>("write_ai_errored_screens_report_cmd", {
        runId,
        stepsDone,
        erroredScreens,
    });
}

export function invokeStopSmokeCheck(): void {
    invoke("stop_smoke_check_cmd").catch(() => {});
}

export async function listenRunProgress(
    handler: (event: RunProgressEvent) => void,
): Promise<UnlistenFn> {
    return listen<RunProgressEvent>("tezzy:run_progress", (e) => handler(e.payload));
}

export type ScreenshotTakenEvent = {
    path: string;
    ts: number;
};

export async function listenScreenshotTaken(handler: (event: ScreenshotTakenEvent) => void) {
    return listen<ScreenshotTakenEvent>("tezzy:screenshot_taken", (e) => handler(e.payload));
}

export type { UnlistenFn };
