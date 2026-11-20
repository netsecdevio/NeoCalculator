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
    protected = root / "Existing.APP"; protected.mkdir()
    (protected / "sentinel").write_text("keep")
    alias = root / "bundle-alias"; alias.symlink_to(protected, target_is_directory=True)
    for base in (protected, alias):
        for command in (["python3", str(repo / "scripts/build-macos-universal.py"), "--output", str(base / "build")],
                        ["python3", str(repo / "scripts/package-macos.py"), str(root / "unused-binary"), str(base / "nested.app"), "--development"],
                        ["python3", str(repo / "scripts/package-macos.py"), str(root / "unused-binary"), str(root / "unused.app"), "--development", "--dmg", str(base / "installer.dmg")]):
            rejected = subprocess.run(command, capture_output=True, text=True)
            assert rejected.returncode == 2 and "app" in rejected.stderr
            assert list(protected.iterdir()) == [protected / "sentinel"]
            assert (protected / "sentinel").read_text() == "keep"
    (root / "library.c").write_text("int fixture_value(void){return 42;}\n")
    (root / "main.c").write_text("extern int fixture_value(void); int main(void){return fixture_value()==42?0:1;}\n")
    for name in ("libSDL3.dylib", "libSDL2.dylib"):
        slices = []
        for arch in ("arm64", "x86_64"):
            target = root / (arch + name)
            run("clang", "-arch", arch, "-mmacosx-version-min=13.0", "-dynamiclib", root / "library.c", "-Wl,-headerpad_max_install_names", "-Wl,-install_name,@rpath/" + ("libSDL3.0.dylib" if name == "libSDL3.dylib" else name), *(["-L" + str(prefix / "lib"), "-lSDL3"] if name == "libSDL2.dylib" else []), "-o", target)
            slices.append(target)
        run("lipo", "-create", *slices, "-output", prefix / "lib" / name)
        if name == "libSDL3.dylib":
            (prefix / "lib" / name).rename(prefix / "lib/libSDL3.0.dylib")
            (prefix / "lib" / name).symlink_to("libSDL3.0.dylib")
    slices = []
    for arch in ("arm64", "x86_64"):
        target = root / arch
        run("clang", "-arch", arch, "-mmacosx-version-min=13.0", root / "main.c", "-Wl,-headerpad_max_install_names", "-L" + str(prefix / "lib"), "-lSDL2", "-o", target)
        slices.append(target)
    binary = root / "fixture"
    run("lipo", "-create", *slices, "-output", binary)
    app = root / "candidate.app"
    run("python3", repo / "scripts/package-macos.py", binary, app, "--emulator-only", "--development", "--universal", "--dependency-prefix", prefix)
    executable = app / "Contents/MacOS/numos"
    for arch in ("arm64", "x86_64"):
        links = subprocess.check_output(["otool", "-arch", arch, "-L", str(executable)], text=True)
        assert "@rpath" not in links and str(prefix) not in links, arch
        assert "@executable_path/../Frameworks/libSDL2.dylib" in links, arch
        for library in (app / "Contents/Frameworks").iterdir():
            links = subprocess.check_output(["otool", "-arch", arch, "-L", str(library)], text=True)
            assert "@rpath" not in links and str(prefix) not in links, (arch, library)
            assert "libSDL3.0.dylib" not in links, (arch, library)
            if library.name == "libSDL2.dylib": assert "@executable_path/../Frameworks/libSDL3.dylib" in links
        # Inspect both slices everywhere; execute both when Rosetta is available.
        available = subprocess.run(["arch", "-" + arch, "/usr/bin/true"], capture_output=True).returncode == 0
        if available: run("arch", "-" + arch, executable)
    run("codesign", "--verify", "--deep", "--strict", app)
    # A prefix-looking absolute load command must not follow a symlink outside.
    outside = root / "outside.dylib"
    outside.write_bytes((prefix / "lib/libSDL2.dylib").read_bytes())
    link = prefix / "lib/escape.dylib"; link.symlink_to(outside)
    run("install_name_tool", "-change", "@rpath/libSDL2.dylib", prefix.resolve() / "lib/escape.dylib", binary)
    rejected = subprocess.run(["python3", str(repo / "scripts/package-macos.py"), str(binary), str(root / "escaped.app"),
        "--emulator-only", "--development", "--universal", "--dependency-prefix", str(prefix)], capture_output=True, text=True)
    assert rejected.returncode != 0 and "escapes isolated prefix" in rejected.stderr
    assert not (root / "escaped.app/Contents/Frameworks/outside.dylib").exists()
    (prefix / "lib/libSDL3.dylib").unlink()
    (prefix / "lib/libSDL3.dylib").symlink_to(outside)
    rejected = subprocess.run(["python3", str(repo / "scripts/package-macos.py"), str(binary), str(root / "escaped-sdl.app"),
        "--emulator-only", "--development", "--universal", "--dependency-prefix", str(prefix)], capture_output=True, text=True)
    assert rejected.returncode != 0 and "SDL3 dependency escapes isolated prefix" in rejected.stderr
    print("PASS: both universal dependency slices verified, available slices launched, prefix escapes rejected")
