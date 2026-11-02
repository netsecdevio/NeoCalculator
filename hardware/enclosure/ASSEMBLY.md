# NeoCalculator enclosure — print and assembly instructions

> ⚠️ Alpha hardware (Rev A). See [`../README.md`](../README.md) before printing anything.

## Printing

Print all parts, then de-burr them.

| Part | File | Orientation | Layer height | Supports |
|:-----|:-----|:------------|:-------------|:---------|
| Case bottom | `case-bottom.stl` | Lay on bottom surface | 0.2 mm | None |
| Case top | `case-top.stl` | Lay on top surface | 0.2 mm | None |
| Display shim | `display-shim.stl` | Smaller offset face uppermost | 0.2 mm | None |
| Switch slider | `switch-slider.stl` | Lay on side, as in the STL | 0.1 mm | Snug |
| Key tops ×50 (+5 spare) | `key.stl` | Lay on top surface | 0.1 mm | None |

For the case parts, set wall order to inner/outer and slow right down for overhangs.
The 5 extra keys are spares in case any have printing defects.

## Hardware needed

- 4× M2 × 10 mm machine screws
- 3× M2 × 8 mm machine screws
- Battery, plus double-sided or Kapton tape

## Assembly

1. Insert the M2 screws into the case bottom so that they only just protrude about 1 mm above the posts. Make sure the holes are reamed out to at least 1.5 mm to avoid breaking the posts. The top 3 are 8 mm and the bottom 4 are 10 mm.
2. Place the battery in the recess in the case bottom and tape it in place with double-sided or Kapton tape. Plug the power cable into the PCBA. Route the cable away from the switch slot.
3. Rest the PCBA on the protruding screws and place the display shim with the smaller offset face uppermost. Screw the top-corner 8 mm screws into the shim to secure the PCBA.
4. Carefully place the switch slider into the recess in the case bottom, with the power switch in the OFF position. The notch faces upwards to engage the power switch. The slider should snap into place, seat itself in the slider hole and be held by the edge of the PCBA. Test the switch at this stage.
5. Fit the screen ribbon cable and gently bend it back on itself to sit under the screen. Do not crease the cable — just tuck it backwards into the gap between the shim rails. Carefully put this assembly to one side.
6. Invert the case top and place the keys individually into the openings, making sure each key sits flat and isn't stuck.
7. Place the bottom case assembly next to the case top, lift the display over into the recess in the case top and gently press it into place. Fold the case bottom over onto the case top and make sure the sides are flush.
8. Fully screw in the four 10 mm screws that go into the case top, and the top 8 mm screw. Be patient — the top posts may be tight. If the case starts to separate while screwing, stop and unscrew until the edges meet, then try again. Some screws may take two or three attempts; don't rush this part.
