#!/usr/bin/env python3
"""Inject native PowerPoint charts (c:chart, double-click editable) into a merged pptx.

Reads <project_dir>/native_charts.json, adds real chart objects (graphicFrame
+ embedded xlsx workbook) at declared SVG-pixel geometry on declared pages.
Run AFTER merge_into_template.py and BEFORE validate_pptx.py.

Chart data lives beside the SVG sources so the SVG keeps a clean whitelist:
draw nothing under the chart area in the SVG — reserve blank space instead.

JSON schema (native_charts.json):
{
  "charts": [
    {
      "page": 4,                        # 1-based slide number
      "x": 672, "y": 381,               # SVG px in 1280x720 canvas
      "w": 518, "h": 168,
      "type": "column",                 # column|bar|line|area|pie|doughnut|radar|radar_filled
      "categories": ["2025", "2026E"],
      "series": [
        {"name": "...", "values": [212, 449],
         "color": "1B4593",             # series color (line color for line type)
         "point_colors": ["85B7EB", "1B4593"]}  # optional per-point fills
      ],
      "legend": false,
      "legend_position": "bottom",      # bottom|right|top|left
      "data_labels": true,
      "label_position": "outside_end",  # outside_end|inside_end|center|above
      "label_size": 13,
      "gap_width": 130,                 # column/bar only
      "overlap": -30,                   # column/bar multi-series only
      "hide_value_axis": true,
      "value_axis_max": 520,
      "cat_font_size": 11
    }
  ]
}

Notes:
- radar / radar_filled (2026-09-08): native radar renders UNRELIABLY in
  LibreOffice (category labels lost, 2nd series missing) — LibreOffice render
  check only verifies geometry presence, NOT content. Delivery requires the
  USER to hand-verify the radar page in real PowerPoint (Kevin's rule).
- radar: line+markers series ("fill": true on a series switches that series
  to filled with 40% alpha). radar_filled: all series filled.
- Embedded workbook: python-pptx auto-attaches an editable xlsx, so customers
  can double-click the chart to edit data in PowerPoint.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

PX = 9525  # 1 SVG px = 1/96 inch
FONT = "Microsoft YaHei"

_TYPE_MAP = {
    "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
    "bar": XL_CHART_TYPE.BAR_CLUSTERED,
    "line": XL_CHART_TYPE.LINE,
    "area": XL_CHART_TYPE.AREA,
    "pie": XL_CHART_TYPE.PIE,
    "doughnut": XL_CHART_TYPE.DOUGHNUT,
    "radar": XL_CHART_TYPE.RADAR_MARKERS,
    "radar_filled": XL_CHART_TYPE.RADAR_FILLED,
}

_LABEL_POS = {
    "outside_end": XL_LABEL_POSITION.OUTSIDE_END,
    "inside_end": XL_LABEL_POSITION.INSIDE_END,
    "center": XL_LABEL_POSITION.CENTER,
    "above": XL_LABEL_POSITION.ABOVE,
}

_LEGEND_POS = {
    "bottom": XL_LEGEND_POSITION.BOTTOM,
    "right": XL_LEGEND_POSITION.RIGHT,
    "top": XL_LEGEND_POSITION.TOP,
    "left": XL_LEGEND_POSITION.LEFT,
}


def _rgb(hexstr: str) -> RGBColor:
    return RGBColor.from_string(hexstr.lstrip("#").upper())


def _set_fill_alpha(ser, alpha_pct: int) -> None:
    """Set solid-fill transparency via XML (python-pptx has no alpha API).

    alpha_pct: opacity percent (e.g. 40 -> 60% transparent). Best-effort:
    silently keeps opaque fill if the XML shape differs.
    """
    try:
        spPr = ser._element.find(qn("c:spPr"))
        if spPr is None:
            return
        solid = spPr.find(qn("a:solidFill"))
        if solid is None:
            return
        clr = solid.find(qn("a:srgbClr"))
        if clr is None:
            return
        for old in clr.findall(qn("a:alpha")):
            clr.remove(old)
        alpha = clr.makeelement(qn("a:alpha"), {"val": str(int(alpha_pct * 1000))})
        clr.append(alpha)
    except Exception:
        pass


def _inject_chart(slide, spec: dict) -> str:
    ctype = spec.get("type", "column")
    if ctype not in _TYPE_MAP:
        raise SystemExit(f"native_charts.json: unknown chart type '{ctype}'")

    x, y = int(spec["x"] * PX), int(spec["y"] * PX)
    w, h = int(spec["w"] * PX), int(spec["h"] * PX)

    data = CategoryChartData()
    data.categories = spec["categories"]
    for ser in spec["series"]:
        data.add_series(ser["name"], tuple(ser["values"]))

    gframe = slide.shapes.add_chart(_TYPE_MAP[ctype], x, y, w, h, data)
    chart = gframe.chart
    chart.font.name = FONT
    chart.has_title = False

    # legend
    if spec.get("legend"):
        chart.has_legend = True
        chart.legend.position = _LEGEND_POS.get(spec.get("legend_position", "bottom"),
                                                 XL_LEGEND_POSITION.BOTTOM)
        chart.legend.include_in_layout = False
        chart.legend.font.size = Pt(spec.get("legend_size", 10))
        chart.legend.font.name = FONT
    else:
        chart.has_legend = False

    plot = chart.plots[0]
    if ctype in ("column", "bar"):
        plot.gap_width = int(spec.get("gap_width", 120))
        if len(spec["series"]) > 1 and spec.get("overlap") is not None:
            plot.overlap = int(spec["overlap"])

    # data labels
    if spec.get("data_labels"):
        plot.has_data_labels = True
        dl = plot.data_labels
        dl.font.size = Pt(spec.get("label_size", 11))
        dl.font.bold = True
        dl.font.name = FONT
        pos = spec.get("label_position")
        if pos:
            try:
                dl.position = _LABEL_POS[pos]
            except Exception:
                pass  # some types reject certain positions; keep default

    # series styling
    for ser_spec, ser in zip(spec["series"], plot.series):
        color = ser_spec.get("color", "1B4593")
        if ctype in ("line",):
            ser.format.line.color.rgb = _rgb(color)
            ser.format.line.width = Pt(ser_spec.get("line_width", 2.0))
            ser.smooth = False
        elif ctype in ("radar", "radar_filled"):
            line_only = ctype == "radar" and not ser_spec.get("fill")
            if line_only:
                # line+markers radar: series fill slot actually paints the line
                ser.format.line.color.rgb = _rgb(color)
                ser.format.line.width = Pt(ser_spec.get("line_width", 2.25))
            else:
                ser.format.fill.solid()
                ser.format.fill.fore_color.rgb = _rgb(color)
                _set_fill_alpha(ser, int(ser_spec.get("fill_alpha", 40)))
                ser.format.line.color.rgb = _rgb(color)
                ser.format.line.width = Pt(ser_spec.get("line_width", 2.0))
        elif ctype in ("area",):
            ser.format.fill.solid()
            ser.format.fill.fore_color.rgb = _rgb(color)
        else:
            ser.format.fill.solid()
            ser.format.fill.fore_color.rgb = _rgb(color)
        for i, pc in enumerate(ser_spec.get("point_colors") or []):
            pt = ser.points[i]
            pt.format.fill.solid()
            pt.format.fill.fore_color.rgb = _rgb(pc)

    # axes (pie/doughnut have none)
    if ctype not in ("pie", "doughnut"):
        va = chart.value_axis
        if spec.get("hide_value_axis", True):
            va.visible = False
        va.has_major_gridlines = False
        if spec.get("value_axis_max") is not None:
            va.maximum_scale = float(spec["value_axis_max"])
        ca = chart.category_axis
        ca.has_major_gridlines = False
        ca.tick_labels.font.size = Pt(spec.get("cat_font_size", 11))
        ca.tick_labels.font.name = FONT
        try:
            ca.format.line.color.rgb = _rgb("778495")
        except Exception:
            pass

    return f"p{spec['page']} {ctype} {spec['w']}x{spec['h']} {len(spec['series'])} series"


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    pptx_path = Path(sys.argv[1])
    project_dir = Path(sys.argv[2])
    strict = "--strict" in sys.argv

    cfg_path = project_dir / "native_charts.json"
    if not cfg_path.is_file():
        print(f"[native_chart_inject] no native_charts.json in {project_dir} — nothing to inject")
        return
    charts = json.loads(cfg_path.read_text(encoding="utf-8")).get("charts", [])
    if not charts:
        print("[native_chart_inject] empty charts[] — nothing to inject")
        return

    prs = Presentation(str(pptx_path))
    done = []
    for spec in charts:
        page = int(spec["page"])
        if not 1 <= page <= len(prs.slides):
            msg = f"native_charts.json: page {page} out of range (1..{len(prs.slides)})"
            if strict:
                raise SystemExit(msg)
            print(f"[WARN] {msg} — skipped")
            continue
        done.append(_inject_chart(prs.slides[page - 1], spec))

    prs.save(str(pptx_path))
    print(f"[native_chart_inject] injected {len(done)} native chart(s):")
    for line in done:
        print(f"  - {line}")
    print(f"[native_chart_inject] saved: {pptx_path}")


if __name__ == "__main__":
    main()
