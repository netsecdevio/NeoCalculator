#!/usr/bin/env python3
"""Rebuild the simulator and its dependencies for arm64/x86_64, macOS 13.

Uses an isolated output prefix; never installs Homebrew packages or touches an app.
Requires Python 3.12+, Xcode tools, CMake, pkg-config and PlatformIO.
"""
import argparse, hashlib, json, os, platform, shutil, subprocess, tarfile, urllib.request
from pathlib import Path

SOURCES = [
    ("SDL3-3.4.20", "https://github.com/libsdl-org/SDL/releases/download/release-3.4.20/SDL3-3.4.20.tar.gz", "f3bb06f55bed9557227a700af2ea62e49497ebdf58037732a731a5fb3ef8581f"),
    ("sdl2-compat-2.32.74", "https://github.com/libsdl-org/sdl2-compat/releases/download/release-2.32.74/sdl2-compat-2.32.74.tar.gz", "ec68abde77e2e459c8abc4f9587b8976b5d2a657b2bfda2fb3a079b0f8924588"),
    ("gettext-1.0", "https://ftp.gnu.org/gnu/gettext/gettext-1.0.tar.gz", "85d99b79c981a404874c02e0342176cf75c7698e2b51fe41031cf6526d974f1a"),
]
def build_triplet(machine):
    architectures = {"arm64":"aarch64", "aarch64":"aarch64", "x86_64":"x86_64"}
    if machine not in architectures: raise ValueError("Unsupported macOS build architecture: " + machine)
    return architectures[machine] + "-apple-darwin"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("out/mac-universal"))
    parser.add_argument("--jobs", type=int, default=6)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 32: parser.error("jobs must be between 1 and 32")
    repo = Path(__file__).resolve().parents[1]
    root = args.output.resolve()
    if root == repo or root in repo.parents or any(part.suffix.lower() == ".app" for part in (root, *root.parents)):
        parser.error("Choose an isolated build directory, never a source parent or installed app")
    root.mkdir(parents=True, exist_ok=True)
    prefix = root / "prefix"
    def run(command, *, cwd=root, env=None, log="build.log"):
        with (root / log).open("a") as stream:
            subprocess.run([str(x) for x in command], cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True)
    for name, url, digest in SOURCES:
        archive = root / (name + ".tar.gz")
        if not archive.exists():
            with urllib.request.urlopen(url, timeout=60) as response: archive.write_bytes(response.read())
        if hashlib.sha256(archive.read_bytes()).hexdigest() != digest: raise SystemExit("Source checksum failed: " + name)
        if not (root / name).exists():
            with tarfile.open(archive) as source: source.extractall(root, filter="data")
    for name, build, options in [
        ("SDL3-3.4.20", "sdl3-build", ["-DSDL_TESTS=OFF", "-DSDL_EXAMPLES=OFF", "-DSDL_SHARED=ON", "-DSDL_STATIC=OFF"]),
        ("sdl2-compat-2.32.74", "sdl2-build", ["-DSDL2COMPAT_TESTS=OFF"]),
    ]:
        run(["cmake", "-S", root / name, "-B", root / build, "-DCMAKE_INSTALL_PREFIX=" + str(prefix), "-DCMAKE_PREFIX_PATH=" + str(prefix), "-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64", "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0", "-DCMAKE_BUILD_TYPE=Release", *options])
        run(["cmake", "--build", root / build, "--parallel", args.jobs])
        run(["cmake", "--install", root / build])
        print("Built universal " + name, flush=True)
    for arch in ("arm64", "x86_64"):
        build = root / ("intl-" + arch); build.mkdir(exist_ok=True)
        install = root / ("intl-prefix-" + arch)
        env = os.environ.copy()
        flags = "-O2 -arch " + arch + " -mmacosx-version-min=13.0"
        env.update(CC="/usr/bin/clang", CXX="/usr/bin/clang++", CFLAGS=flags, CXXFLAGS=flags, LDFLAGS=flags, MACOSX_DEPLOYMENT_TARGET="13.0", am_cv_func_iconv_works="yes")
        run([root / "gettext-1.0/gettext-runtime/configure", "--prefix=" + str(install), "--disable-dependency-tracking", "--disable-java", "--disable-csharp", "--disable-libasprintf", "--with-included-gettext", "--disable-static", "--without-libiconv-prefix", "--without-libunistring-prefix", "--build=" + build_triplet(platform.machine()), "--host=" + ("aarch64" if arch == "arm64" else arch) + "-apple-darwin"], cwd=build, env=env)
        run(["make", "-C", "intl", "-j" + str(args.jobs)], cwd=build, env=env)
        run(["make", "-C", "intl", "install"], cwd=build, env=env)
    run(["lipo", "-create", root / "intl-prefix-arm64/lib/libintl.8.dylib", root / "intl-prefix-x86_64/lib/libintl.8.dylib", "-output", prefix / "lib/libintl.8.dylib"])
    run(["install_name_tool", "-id", prefix / "lib/libintl.8.dylib", prefix / "lib/libintl.8.dylib"])
    link = prefix / "lib/libintl.dylib"
    if not link.exists(): link.symlink_to("libintl.8.dylib")
    shutil.copy2(root / "intl-prefix-arm64/include/libintl.h", prefix / "include/libintl.h")
    for arch in ("arm64", "x86_64"):
        env = os.environ.copy()
        env.update(MACOSX_DEPLOYMENT_TARGET="13.0", NUMOS_MAC_ARCH=arch, NUMOS_MAC_DEPS_PREFIX=str(prefix), PKG_CONFIG_PATH=str(prefix / "lib/pkgconfig"), PKG_CONFIG_LIBDIR=str(prefix / "lib/pkgconfig"), PLATFORMIO_BUILD_DIR=str(root / ("emulator-" + arch)))
        run(["pio", "run", "-e", "emulator_pc", "-j", args.jobs], cwd=repo, env=env, log="emulator-" + arch + ".log")
        print("Built simulator " + arch, flush=True)
    run(["lipo", "-create", root / "emulator-arm64/emulator_pc/program", root / "emulator-x86_64/emulator_pc/program", "-output", root / "numos-universal"])
    (root / "sources.json").write_text(json.dumps({"minimumMacOS":"13.0", "architectures":["arm64","x86_64"], "dependencies":[{"name":n,"url":u,"sha256":h} for n,u,h in SOURCES]}, indent=2)+"\n")
    print("Universal simulator: " + str(root / "numos-universal"))
    print("Package with --universal --dependency-prefix " + str(prefix))

if __name__ == "__main__": main()
