# Shared calculator foundation

Tracking: BF-19 (epic), BF-20 (foundation), BF-21 (Mac), BF-22 (Brainfood), SIL-1047 (Silas).
Fork baseline: 39d7d1ed50b2079f19534376c7b7146738bd9a1e. Software retains GPL-3.0-or-later and all component notices. A local development app is not a signed/notarized distribution release.

Native Mac build:

    brew install platformio sdl2 sdl3 pkg-config gettext
    PLATFORMIO_BUILD_DIR="$PWD/out/native-build" pio run -e emulator_pc
    out/native-build/emulator_pc/program --headless --deterministic --frames 7000 --script tests/emulator/scripts/production_demo_acceptance.numos
    # Activate the installed Emscripten 6.0.3 environment first.
    bash wasm/math/build.sh Release
    python3 scripts/package-macos.py out/native-build/emulator_pc/program out/silascalc.app --development

The default package includes the shared learning workspace and native “Connect to Silas…” setup. Build from a clean reviewed checkout. `--learning-workspace` remains an explicit alias for the default; `--emulator-only` opts into the legacy simulator without learning or pairing.

Use a fresh candidate app destination; the packager refuses to overwrite an existing app. It packages Homebrew SDL2 compatibility, its dynamically loaded SDL3 dependency, and linked non-system libraries. It signs locally with an ad-hoc identity, not an Apple distribution certificate. Runtime state lives in the user's Application Support directory. Current build is host architecture only.

Web math: activate Emscripten 6.0.3, then run `bash wasm/math/build.sh Release`. Run `npm ci --prefix tests/wasm`, install that Playwright version's browsers, and run `node tests/wasm/math.mjs`. The math-only target includes no programming application or host filesystem bridge.

The worker client now has a 5-second default request deadline (configurable 100–30000 ms), a 16-request queue bound, and bounded graph sampling. Deadline or worker failure terminates the session; callers must create a fresh session. Explicit cancel retains the existing restart contract. The worker accepts an explicit operation list and limits retained expressions to 32, freeing disposed entries.

Integration acceptance still includes offline WKWebView, profile isolation, application capabilities/content policy, and subject-specific correctness. Do not replace the working lesson tools until those gates pass. Host pages should expose only math, keep sessions ephemeral initially, and never pass credentials into calculator content.


### Mac release and Keychain recovery

The native shell keeps Keychain work off its HTTP/UI queues. Normal requests do not initiate an authorization prompt; choose **Unlock saved connection** to explicitly authorize an existing login-Keychain item. If a setup code was accepted but saving requires authorization, keep the app open and choose **Retry saving connection**. The pending credential remains in memory; existing Keychain items and ACLs are not deleted or relaxed.

Development packaging requires `--development`. Family release packaging uses a stable Developer ID Application identity with hardened runtime and timestamps. Rebuild native dependencies and both simulator slices before distributing to older Macs:

```sh
python3 scripts/build-macos-universal.py --output out/mac-universal
python3 scripts/package-macos.py out/mac-universal/numos-universal out/silascalc-family.app \
  --universal --dependency-prefix out/mac-universal/prefix \
  --sign-identity "Developer ID Application: YOUR IDENTITY" \
  --dmg out/silascalc-family.dmg --notary-profile YOUR_EXISTING_PROFILE
```

The packager rejects missing arm64/x86_64 slices or native dependencies requiring newer than macOS13, preserves existing destinations, and reports distribution readiness only after Apple's accepted receipt, stapled ticket validation and Gatekeeper assessment. Notary credentials stay in the existing Keychain profile, never in arguments or source. Universal compatibility is established by inspecting every bundled native image; real Intel hardware acceptance remains a separate release check.
