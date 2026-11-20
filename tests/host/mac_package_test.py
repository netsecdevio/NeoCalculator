"""Real Mach-O fixture: universal @rpath dependencies must be bundled and rewritten."""
import os, platform, subprocess, tempfile, runpy
from pathlib import Path
repo = Path(__file__).resolve().parents[2]
triplet = runpy.run_path(str(repo / "scripts/build-macos-universal.py"))["build_triplet"]
assert triplet("arm64") == "aarch64-apple-darwin"
assert triplet("x86_64") == "x86_64-apple-darwin"
try: triplet("unsupported")
except ValueError: pass
else: raise AssertionError("Unknown build architecture accepted")
def run(*args): subprocess.run([str(x) for x in args], check=True, stdout=subprocess.DEVNULL)
with tempfile.TemporaryDirectory(prefix="silascalc-package-test-") as folder:
    root = Path(folder); prefix = root / "prefix"; (prefix / "lib").mkdir(parents=True)
    (root / "library.c").write_text("int fixture_value(void){return 42;}\n")
    (root / "main.c").write_text("extern int fixture_value(void); int main(void){return fixture_value()==42?0:1;}\n")
    for name in ("libSDL3.dylib", "libSDL2.dylib"):
        slices = []
        for arch in ("arm64", "x86_64"):
            target = root / (arch + name)
            run("clang", "-arch", arch, "-mmacosx-version-min=13.0", "-dynamiclib", root / "library.c", "-Wl,-install_name,@rpath/" + name, "-o", target)
            slices.append(target)
        run("lipo", "-create", *slices, "-output", prefix / "lib" / name)
    slices = []
    for arch in ("arm64", "x86_64"):
        target = root / arch
        run("clang", "-arch", arch, "-mmacosx-version-min=13.0", root / "main.c", "-L" + str(prefix / "lib"), "-lSDL2", "-o", target)
        slices.append(target)
    binary = root / "fixture"
    run("lipo", "-create", *slices, "-output", binary)
    app = root / "candidate.app"
    run("python3", repo / "scripts/package-macos.py", binary, app, "--emulator-only", "--development", "--universal", "--dependency-prefix", prefix)
    executable = app / "Contents/MacOS/numos"
    links = subprocess.check_output(["otool", "-L", str(executable)], text=True)
    assert "@rpath" not in links and str(prefix) not in links
    assert "@executable_path/../Frameworks/libSDL2.dylib" in links
    run("arch", "-" + platform.machine(), executable)
    run("codesign", "--verify", "--deep", "--strict", app)
    print("PASS: isolated universal @rpath fixture runs from the packaged bundle")
