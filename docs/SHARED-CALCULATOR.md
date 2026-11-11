# Shared calculator foundation

Tracking: BF-19 (epic), BF-20 (foundation), BF-21 (Mac), BF-22 (Brainfood), SIL-1047 (Silas).
Fork baseline: 39d7d1ed50b2079f19534376c7b7146738bd9a1e. Software retains GPL-3.0-or-later and all component notices. A local development app is not a signed/notarized distribution release.

Native Mac build:

    brew install platformio sdl2 pkg-config gettext
    PLATFORMIO_BUILD_DIR="$PWD/out/native-build" pio run -e emulator_pc
    out/native-build/emulator_pc/program --headless --deterministic --frames 7000 --script tests/emulator/scripts/production_demo_acceptance.numos
    python3 scripts/package-macos.py out/native-build/emulator_pc/program out/NeoCalculator.app

Use a fresh candidate app destination; the packager refuses to overwrite an existing app. It packages Homebrew SDL2 compatibility, its dynamically loaded SDL3 dependency, and linked non-system libraries. It signs locally with an ad-hoc identity, not an Apple distribution certificate. Runtime state lives in the user's Application Support directory. Current build is host architecture only.

Web math: activate Emscripten 6.0.3, then run `bash wasm/math/build.sh Release`. Run `npm ci --prefix tests/wasm`, install that Playwright version's browsers, and run `node tests/wasm/math.mjs`. The math-only target includes no programming application or host filesystem bridge.

The worker client now has a 5-second default request deadline (configurable 100–30000 ms), a 16-request queue bound, and bounded graph sampling. Deadline or worker failure terminates the session; callers must create a fresh session. Explicit cancel retains the existing restart contract. The worker accepts an explicit operation list and limits retained expressions to 32, freeing disposed entries.

Integration acceptance still includes offline WKWebView, profile isolation, application capabilities/content policy, and subject-specific correctness. Do not replace the working lesson tools until those gates pass. Host pages should expose only math, keep sessions ephemeral initially, and never pass credentials into calculator content.
