#!/usr/bin/env python3
"""Package an explicit development or Developer ID Mac candidate; never replace an app."""
import argparse, plistlib, shutil, subprocess, tempfile, json, re, platform
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument("binary", type=Path)
parser.add_argument("destination", type=Path)
mode = parser.add_mutually_exclusive_group()
mode.add_argument("--learning-workspace", dest="learning_workspace", action="store_true", default=True,
                  help="Package the shared learning workspace (default)")
mode.add_argument("--emulator-only", dest="learning_workspace", action="store_false",
                  help="Package only the legacy simulator, without learning or pairing")
signing = parser.add_mutually_exclusive_group(required=True)
signing.add_argument("--development", action="store_true", help="Explicit ad-hoc local development build")
signing.add_argument("--sign-identity", help="Developer ID Application identity name or SHA-1")
parser.add_argument("--universal", action="store_true", help="Require arm64 + x86_64 and macOS13-compatible native dependencies")
parser.add_argument("--dependency-prefix", type=Path, help="Isolated rebuilt native dependency prefix")
parser.add_argument("--notary-profile", help="Existing notarytool Keychain profile name; never pass a password here")
parser.add_argument("--dmg", type=Path, help="Create a drag-to-Applications installer disk image")
args = parser.parse_args()
if args.notary_profile and (args.development or not args.dmg):
    parser.error("Notarization requires --sign-identity and --dmg")
if args.dmg and (args.dmg.suffix != ".dmg" or args.dmg.exists()):
    parser.error("Choose a new .dmg destination; existing installers are preserved")
if args.sign_identity:
    identities = subprocess.check_output(["security", "find-identity", "-v", "-p", "codesigning"], text=True)
    valid = re.findall(r'([A-Fa-f0-9]{40}) "(Developer ID Application:[^"]+)"', identities)
    match = [(digest, name) for digest, name in valid if args.sign_identity in (digest, name)]
    if len(match) != 1:
        parser.error("Select one valid Developer ID Application identity (Apple Development/ad-hoc cannot be notarized)")
    identity = match[0][0]
else:
    identity = "-"
def sign(path):
    command = ["codesign", "--force", "--sign", identity]
    if args.sign_identity: command += ["--options", "runtime", "--timestamp"]
    subprocess.run(command + [str(path)], check=True)

def notarize(path, receipt):
    if receipt.exists(): raise SystemExit("Notary receipt already exists; preserve it and choose a new installer name")
    result = subprocess.run(["xcrun", "notarytool", "submit", str(path), "--keychain-profile", args.notary_profile,
                             "--wait", "--timeout", "30m", "--output-format", "json"], capture_output=True, text=True)
    receipt.write_text(result.stdout); receipt.chmod(0o600)
    try: response = json.loads(result.stdout)
    except ValueError: raise SystemExit("Notarization did not produce a receipt; check the configured Keychain profile")
    if result.returncode != 0 or response.get("status") != "Accepted":
        raise SystemExit("Notarization was not accepted; candidate is not ready to distribute. Receipt: " + str(receipt))

app = args.destination.resolve()
if app.exists():
    raise SystemExit("Destination already exists; preserve it and choose a new candidate path")
mac = app / "Contents/MacOS"
frameworks = app / "Contents/Frameworks"
mac.mkdir(parents=True)
frameworks.mkdir()
exe = mac / "numos"
shutil.copy2(args.binary, exe)
queue = [exe]
copied = {}
# SDL2 compatibility loads SDL3 dynamically, so otool cannot discover it.
sdl3_dir = str(args.dependency_prefix.resolve() / "lib") if args.dependency_prefix else subprocess.check_output(["pkg-config", "--variable=libdir", "sdl3"], text=True).strip()
sdl3 = Path(sdl3_dir) / "libSDL3.dylib"
if args.dependency_prefix and not sdl3.resolve().is_relative_to(args.dependency_prefix.resolve()):
    raise SystemExit("SDL3 dependency escapes isolated prefix")
bundled_sdl3 = frameworks / "libSDL3.dylib"
shutil.copy2(sdl3, bundled_sdl3)
copied[sdl3.resolve()] = bundled_sdl3
queue.append(bundled_sdl3)
subprocess.run(["install_name_tool", "-id", "@executable_path/../Frameworks/libSDL3.dylib", str(bundled_sdl3)], check=True)
while queue:
    target = queue.pop()
    architectures = subprocess.check_output(["lipo", "-archs", str(target)], text=True).split()
    lines = sorted({line for arch in architectures for line in subprocess.check_output(
        ["otool", "-arch", arch, "-L", str(target)], text=True).splitlines()[1:]})
    for line in lines:
        dependency = line.strip().split(" (", 1)[0]
        if dependency.startswith(("/System/Library/", "/usr/lib/")) or dependency == str(target):
            continue
        if dependency.startswith("@rpath/"):
            name = dependency.removeprefix("@rpath/")
            if not args.dependency_prefix or Path(name).name != name:
                raise SystemExit("Resolve @rpath dependencies with --dependency-prefix: " + dependency)
            source = (args.dependency_prefix.resolve() / "lib" / name).resolve()
            if not source.is_file() or not source.is_relative_to(args.dependency_prefix.resolve()):
                raise SystemExit("Missing isolated native dependency: " + dependency)
        elif dependency.startswith("@executable_path/../Frameworks/"):
            name = dependency.removeprefix("@executable_path/../Frameworks/")
            if Path(name).name != name or not (frameworks / name).is_file():
                raise SystemExit("Missing bundled native dependency: " + dependency)
            continue
        else:
            allowed = ("/opt/homebrew/", "/usr/local/") + ((str(args.dependency_prefix.resolve()) + "/",) if args.dependency_prefix else ())
            if not dependency.startswith(allowed):
                raise SystemExit("Native dependency needs an explicit --dependency-prefix: " + dependency)
            source = Path(dependency).resolve()
            if args.dependency_prefix and not source.is_relative_to(args.dependency_prefix.resolve()):
                raise SystemExit("Native dependency escapes isolated prefix: " + dependency)
        bundled = frameworks / source.name
        if source not in copied:
            if bundled.exists():
                raise SystemExit("Conflicting dependency names: " + source.name)
            shutil.copy2(source, bundled)
            copied[source] = bundled
            queue.append(bundled)
            subprocess.run(["install_name_tool", "-id", "@executable_path/../Frameworks/" + source.name, str(bundled)], check=True)
        subprocess.run(["install_name_tool", "-change", dependency, "@executable_path/../Frameworks/" + source.name, str(target)], check=True)
launcher = mac / "NeoCalculator"
launcher.write_text('#!/bin/sh\nset -eu\napp_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nstate_dir="$HOME/Library/Application Support/NeoCalculator"\nmkdir -p "$state_dir"\ncd "$state_dir"\nexport DYLD_LIBRARY_PATH="$app_dir/../Frameworks"\nexec "$app_dir/numos" "$@"\n')
launcher.chmod(0o755)
(app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleName":"silascalc", "CFBundleDisplayName":"silascalc", "CFBundleIconFile":"silascalc.icns", "CFBundleIdentifier":"io.netsecdev.neocalculator", "CFBundleExecutable":"NeoCalculator", "CFBundlePackageType":"APPL", "CFBundleVersion":"1", "CFBundleShortVersionString":"0.1.0", "NSHighResolutionCapable":True}))
resources = app / "Contents/Resources"
resources.mkdir()
repo = Path(__file__).resolve().parents[1]
shutil.copy2(repo / "macos/silascalc.icns", resources / "silascalc.icns")
for name in ("LICENSE.md", "LICENSE-SOFTWARE", "THIRD_PARTY_NOTICES.md"):
    shutil.copy2(repo / name, resources / name)
(resources / "SOURCE.txt").write_text("Source: https://github.com/netsecdevio/NeoCalculator\nBuilt for the current Mac architecture. " + ("Developer ID candidate; notarization requires an accepted notary receipt and stapled ticket.\n" if args.sign_identity else "Local development build; ad-hoc signed and not notarized.\n"))
if args.learning_workspace:
    import json, hashlib
    dist = repo / "out/wasm-math/dist/release"
    manifest = json.loads((dist / "numos-math-assets.json").read_text())
    if "-dirty" in manifest["build"]["identity"]:
        raise SystemExit("Build the learning workspace from a clean reviewed checkout")
    destination = resources / "calculator"
    destination.mkdir()
    names = ["index.html", "numos-math-assets.json"] + [v["url"].removeprefix("./") for v in manifest["assets"].values()]
    assets = {}
    for name in names:
        if Path(name).name != name:
            raise SystemExit("Invalid calculator asset name")
        shutil.copy2(dist / name, destination / name)
        assets[name] = hashlib.sha256((destination / name).read_bytes()).hexdigest()
    (destination / "SOURCE.json").write_text(json.dumps({"revision":manifest["build"]["gitRevision"],"assets":assets},indent=2)+"\n")
    desktop = mac / "NeoCalculatorDesktop"
    architectures = ["arm64", "x86_64"] if args.universal else [platform.machine()]
    slices = []
    with tempfile.TemporaryDirectory(prefix="silascalc-swift-") as folder:
        for arch in architectures:
            output = Path(folder) / arch
            subprocess.run(["xcrun", "swiftc", "-target", arch + "-apple-macos13.0", str(repo / "macos/LearningCalculator.swift"), str(repo / "macos/KeychainConnection.swift"), "-o", str(output), "-framework", "AppKit", "-framework", "WebKit", "-framework", "Network", "-framework", "Security", "-framework", "LocalAuthentication"], check=True)
            slices.append(str(output))
        subprocess.run(["lipo", "-create", *slices, "-output", str(desktop)], check=True)
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    info["CFBundleExecutable"] = "NeoCalculatorDesktop"
    info["NSAppTransportSecurity"] = {"NSAllowsLocalNetworking":True}
    (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
    launcher.unlink()  # The native shell now launches numos directly.
native = [*copied.values(), exe] + ([desktop] if args.learning_workspace else [])
minimums = []
for binary in native:
    architectures = set(subprocess.check_output(["lipo", "-archs", str(binary)], text=True).split())
    build = subprocess.check_output(["xcrun", "vtool", "-show-build", str(binary)], text=True)
    versions = [tuple(int(part) for part in value.split(".")) for value in re.findall(r"minos\s+([0-9.]+)", build)]
    if not versions: raise SystemExit("Cannot verify minimum macOS for " + str(binary))
    minimums += versions
    if args.universal and (architectures != {"arm64", "x86_64"} or any((v + (0, 0))[:3] > (13, 0, 0) for v in versions)):
        raise SystemExit("Universal installer requires both slices targeting macOS13 or earlier: " + str(binary))
info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
info["LSMinimumSystemVersion"] = ".".join(str(v) for v in max(minimums))
(app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
if args.universal:
    with (resources / "SOURCE.txt").open("a") as note: note.write("Verified universal arm64/x86_64 code; minimum macOS13.0.\n")
for binary in [*copied.values(), exe]:
    sign(binary)
if args.learning_workspace:
    sign(desktop)
sign(app)
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
if args.sign_identity:
    details = subprocess.run(["codesign", "--display", "--verbose=4", str(app)], capture_output=True, text=True, check=True).stderr
    if "Authority=Developer ID Application:" not in details or "runtime" not in details:
        raise SystemExit("Developer ID/hardened-runtime verification failed")
if args.dmg:
    dmg = args.dmg.resolve(); dmg.parent.mkdir(parents=True, exist_ok=True)
    if args.notary_profile:
        # Staple the application first so dragging it out of the DMG preserves
        # its offline ticket. A ticket on the disk image alone is insufficient.
        with tempfile.TemporaryDirectory(prefix="silascalc-notary-") as folder:
            archive = Path(folder) / "silascalc.zip"
            subprocess.run(["ditto", "-c", "-k", "--keepParent", str(app), str(archive)], check=True)
            notarize(archive, dmg.with_suffix(".app.notary.json"))
        subprocess.run(["xcrun", "stapler", "staple", str(app)], check=True)
        subprocess.run(["xcrun", "stapler", "validate", str(app)], check=True)
        subprocess.run(["spctl", "--assess", "--type", "execute", str(app)], check=True)
    with tempfile.TemporaryDirectory(prefix="silascalc-installer-") as folder:
        stage = Path(folder)
        shutil.copytree(app, stage / "silascalc.app", symlinks=True)
        (stage / "Applications").symlink_to("/Applications")
        subprocess.run(["hdiutil", "create", "-volname", "silascalc", "-srcfolder", str(stage), "-format", "UDZO", str(dmg)], check=True)
    sign(dmg)
    if args.notary_profile:
        notarize(dmg, dmg.with_suffix(".notary.json"))
        subprocess.run(["xcrun", "stapler", "staple", str(dmg)], check=True)
        subprocess.run(["xcrun", "stapler", "validate", str(dmg)], check=True)
        subprocess.run(["spctl", "--assess", "--type", "open", "--context", "context:primary-signature", str(dmg)], check=True)
        print("Notarized and stapled installer: " + str(dmg))
    else:
        print("Installer candidate (not notarized): " + str(dmg))
print(app)
