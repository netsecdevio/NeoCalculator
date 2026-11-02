# NeoCalculator hardware

> ⚠️ **Alpha hardware — not final. Please don't order PCBs or print enclosures yet.** This is an early revision published for transparency and review. The schematic, board layout, parts and enclosure are still changing and the next revision may not be compatible with this one. If you build it anyway, you do so at your own risk and cost.

| | |
|:--|:--|
| **Revision** | Rev A (alpha) |
| **Published** | 2026-11-02 |
| **Firmware at time of publication** | NumOS `ab40177` |

## Contents

### `pcb/` — main board

Two-layer board, 76 × 156 mm: ESP32-S3-WROOM-1U-N16R8, TP4056 Li-ion charger with DW01 + 8205A protection, RT6150A buck-boost regulator, USB-C, 40-pin FPC display connector, and a 5 × 10 key matrix (50 keys, one 1N4148 diode per key).

| File | What it is | Opens with |
|:-----|:-----------|:-----------|
| `neocalculator.kicad_sch` | Schematic source | KiCad 10.0 or later |
| `neocalculator.kicad_pcb` | Board layout source | KiCad 10.0 or later |
| `neocalculator-schematic.pdf` | Schematic export | Any PDF viewer |
| `neocalculator-board-outline.pdf` | Board outline / placement drawing with enclosure dimensions | Any PDF viewer |
| `neocalculator-gerbers.zip` | Gerbers + drill files, ready to upload to JLCPCB | Any Gerber viewer |
| `neocalculator-bom.xlsx` | Bill of materials with JLCPCB/LCSC part numbers | Excel, LibreOffice |
| `neocalculator-cpl.xlsx` | Pick-and-place (component placement list) | Excel, LibreOffice |

The display (Z320IT008-D, connected over SPI) and the Li-ion battery are off-board parts and are not in the BOM.

The schematic still shows the original USB-C connector (`type-c 16pin 2md(073)`); the layout, Gerbers and BOM use the HANBO MC-121-L124 that replaced it during layout. The BOM is the reference for the fitted part.

### `enclosure/` — 3D-printed case

Body 84 × 172 mm. Published as STL meshes (CAD sources are not included in this release).

| File | Part |
|:-----|:-----|
| `case-top.stl` | Case top |
| `case-bottom.stl` | Case bottom |
| `key.stl` | Key top (print 50, plus spares) |
| `switch-slider.stl` | Power switch slider |
| `display-shim.stl` | Display shim |
| `ASSEMBLY.md` | Print settings and assembly steps |

### `keyboard/` — keypad map

Machine-readable keypad layout and the generated key map used by the firmware's production keypad pipeline.

## License

The NeoCalculator hardware design files in this directory are licensed under the **CERN Open Hardware Licence Version 2 — Strongly Reciprocal (CERN-OHL-S-2.0)**. The full text is in [`LICENSE-HARDWARE`](../LICENSE-HARDWARE).

The NumOS firmware is licensed separately; see [`LICENSE.md`](../LICENSE.md).

## Credits

- **PCB design:** El-EnderJ
- **Enclosure design:** Charles Baynes
