# Week 2 Implementation Complete ✅

## What was built

### Rust Backend

**New Drivers:**
- `drivers/scrcpy.rs` - scrcpy process lifecycle management (start/stop/status)
- `drivers/apk.rs` - APK install, package detection (fallback), and app launching

**Extended Core:**
- `core/process.rs` - Added `scrcpy` to executable allowlist
- `core/storage.rs` - Run artifacts folder creation with metadata and log writing
- `core/events.rs` - Added `tezzy:scrcpy_state` event for preview status

**New Commands:**
- `commands/scrcpy.rs` - `start_scrcpy_preview`, `stop_scrcpy_preview`, `get_scrcpy_preview_status`
- `commands/apk.rs` - `install_and_launch_apk` (full pipeline with artifacts)

### React Frontend

**New Components:**
- `features/preview/LivePreviewPanel.tsx` - Live preview with Start/Stop buttons and APK drag-and-drop

**Updated Components:**
- `app/layout.tsx` - Integrated LivePreviewPanel into center panel
- `lib/tauri.ts` - Added TypeScript types and invoke functions for scrcpy and APK operations

### Documentation

- `docs/architecture.md` - Week 2 section with design decisions, security considerations, and limitations

---

## Features

### 1. scrcpy Preview
- **Start Preview** button spawns scrcpy for active device
- scrcpy opens in separate native window (controlled bitrate: 8Mbps, max size: 1080)
- **Stop Preview** button kills scrcpy process
- Status indicator shows "running" or "stopped"
- Logs emitted to System Log panel

### 2. APK Drag-and-Drop Install
- Drag .apk file onto Live Preview panel
- Validates file path and extension
- Installs APK with `adb install -r` (replace existing)
- Detects package name via before/after diff fallback
- Launches app automatically using monkey tool
- Shows success/failure feedback with package name

### 3. Run Artifacts
Each installation creates `reports/tezzy-run-<timestamp>/`:
- `meta.json` - device serial, APK filename, package name, timestamp
- `logs/adb_install.txt` - install command stdout
- `logs/adb_install_stderr.txt` - install errors (if any)

---

## Security

✅ **No shell invocation** - All commands use direct `std::process::Command`  
✅ **Executable allowlist** - Only `adb` and `scrcpy` permitted  
✅ **Device serial validation** - Alphanumeric + `_-.:` only  
✅ **APK path validation** - Must exist, be a file, .apk extension  
✅ **Package name validation** - No path separators  
✅ **Log truncation** - Prevents unbounded memory growth  

---

## Known Limitations

⚠️ **scrcpy must be installed separately** - User needs scrcpy on PATH  
⚠️ **Package detection fallback** - Fails on reinstalls (no new package detected)  
⚠️ **No aapt2 integration** - Week 2 uses adb pm list diff only  
⚠️ **No streaming for scrcpy** - stdout/stderr not captured (scrcpy manages own window)  
⚠️ **No artifact retention policy** - User must manually clean reports/ folder  

---

## What to install before testing

### scrcpy (required for preview)
**Windows:**
```powershell
# Option 1: Chocolatey
choco install scrcpy

# Option 2: Scoop
scoop install scrcpy

# Option 3: Download from GitHub
# https://github.com/Genymobile/scrcpy/releases
# Extract and add to PATH
```

**Verify installation:**
```powershell
scrcpy --version
```

---

## Testing the app

1. **Build and run:**
   ```powershell
   cd g:\personal-projects\Tezzy\ai-mobile-qa\apps\desktop
   npm run tauri dev
   ```

2. **Connect Android device** with USB debugging enabled

3. **Select device** from the dropdown (refresh if needed)

4. **Test scrcpy preview:**
   - Click "Start Preview"
   - scrcpy window should open showing device screen
   - Click "Stop Preview" to close

5. **Test APK install:**
   - Drag any .apk file onto the "Live Preview" panel
   - Watch System Log for install/launch progress
   - Check `reports/tezzy-run-<timestamp>/` for artifacts

---

## Next Steps (Week 3+)

Future improvements:
- [ ] Add aapt2 integration for reliable package detection
- [ ] Screenshot capture to run artifacts
- [ ] Appium server management
- [ ] UI element inspector
- [ ] Test recording/playback
- [ ] Performance monitoring

---

## Files Created/Modified

### New Files (12)
1. `src-tauri/src/drivers/scrcpy.rs`
2. `src-tauri/src/drivers/apk.rs`
3. `src-tauri/src/commands/scrcpy.rs`
4. `src-tauri/src/commands/apk.rs`
5. `src/features/preview/LivePreviewPanel.tsx`
6. `WEEK_2_SUMMARY.md` (this file)

### Modified Files (7)
1. `src-tauri/src/core/process.rs` - Added scrcpy to allowlist
2. `src-tauri/src/core/storage.rs` - Added run folder creation
3. `src-tauri/src/core/events.rs` - Added scrcpy_state event
4. `src-tauri/src/drivers/mod.rs` - Registered new drivers
5. `src-tauri/src/commands/mod.rs` - Registered new commands
6. `src-tauri/src/main.rs` - Registered Tauri commands
7. `src/lib/tauri.ts` - Added types and invoke functions
8. `src/app/layout.tsx` - Integrated LivePreviewPanel
9. `docs/architecture.md` - Added Week 2 documentation

---

**Status:** Week 2 complete and ready for testing! 🎉
