#!/usr/bin/env python3
"""Package a local-development Mac app; does not claim notarization or universal support."""
import argparse, plistlib, shutil, subprocess
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument("binary", type=Path)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
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
sdl3_dir = subprocess.check_output(["pkg-config", "--variable=libdir", "sdl3"], text=True).strip()
sdl3 = Path(sdl3_dir) / "libSDL3.dylib"
bundled_sdl3 = frameworks / "libSDL3.dylib"
shutil.copy2(sdl3, bundled_sdl3)
copied[sdl3.resolve()] = bundled_sdl3
queue.append(bundled_sdl3)
while queue:
    target = queue.pop()
    lines = subprocess.check_output(["otool", "-L", str(target)], text=True).splitlines()[1:]
    for line in lines:
        dependency = line.strip().split(" (", 1)[0]
        if not dependency.startswith(("/opt/homebrew/", "/usr/local/")):
            continue
        source = Path(dependency).resolve()
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
launcher.write_text('#!/bin/sh\nset -eu\napp_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nstate_dir="$HOME/Library/Application Support/NeoCalculator"\nmkdir -p "$state_dir"\ncd "$state_dir"\nexec "$app_dir/numos" "$@"\n')
launcher.chmod(0o755)
(app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleName":"NeoCalculator", "CFBundleDisplayName":"NeoCalculator", "CFBundleIdentifier":"io.netsecdev.neocalculator", "CFBundleExecutable":"NeoCalculator", "CFBundlePackageType":"APPL", "CFBundleVersion":"1", "CFBundleShortVersionString":"0.1.0", "NSHighResolutionCapable":True}))
resources = app / "Contents/Resources"
resources.mkdir()
repo = Path(__file__).resolve().parents[1]
for name in ("LICENSE.md", "LICENSE-SOFTWARE", "THIRD_PARTY_NOTICES.md"):
    shutil.copy2(repo / name, resources / name)
(resources / "SOURCE.txt").write_text("Local development build. Source: https://github.com/netsecdevio/NeoCalculator\nNot notarized; built for the current Mac architecture.\n")
for binary in [*copied.values(), exe]:
    subprocess.run(["codesign", "--force", "--sign", "-", str(binary)], check=True)
subprocess.run(["codesign", "--force", "--sign", "-", str(app)], check=True)
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
print(app)
