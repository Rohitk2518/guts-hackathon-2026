"""
build.py — Stage 6 of the pipeline.
Owner: Shradha

Reads (from data/):
  - people_data.csv          students table
  - security_logs.csv        stays (log entries)
  - location_data.csv        buildings
  - claims_extracted.csv     LLM claim output from claims.py
  - testimony_flags.csv      TESTIMONY rule flags from claims.py
  - graph_edges.csv          co-presence edges from graph.py
  (optionally) rules_flags.csv  OOH/NIGHT/LECTURE/TELEPORT/IDENTITY from Bhushan's rules.py

Produces:
  - web/data.json            the contract file the browser reads

Usage:
  python pipeline/build.py
"""

import re
import ast
import json
from pathlib import Path

import pandas as pd
import networkx as nx

from graph import build_graph, load_stays

ROOT_DIR = Path(__file__).resolve().parent.parent
RAW_DIR  = ROOT_DIR / "data"
WEB_DIR  = ROOT_DIR / "web"
WEB_DIR.mkdir(exist_ok=True)

# ── severity → numeric weight for scoring ──────────────────────────────────────
SEVERITY_WEIGHT = {"high": 3.5, "medium": 2.0, "low": 0.8}


# ── loaders ────────────────────────────────────────────────────────────────────

def load_students() -> pd.DataFrame:
    df = pd.read_csv(RAW_DIR / "people_data.csv")
    df.columns = df.columns.str.strip()
    df["student_id"] = df["Student ID"].str.strip().str.upper()
    df["name"]       = df["Name"].str.strip()
    return df


def load_buildings() -> pd.DataFrame:
    df = pd.read_csv(RAW_DIR / "location_data.csv")
    df.columns = df.columns.str.strip()
    return df


def parse_latlon(geo: str) -> tuple[float, float]:
    """'{55.87 -4.29}' → (55.87, -4.29)"""
    nums = re.findall(r"[-\d.]+", str(geo))
    if len(nums) >= 2:
        return float(nums[0]), float(nums[1])
    return 0.0, 0.0


def parse_opening(times: str) -> tuple[int, int]:
    """'0800-2100' → (480, 1260)"""
    match = re.match(r"(\d{4})-(\d{4})", str(times).strip())
    if match:
        def hhmm(s): return int(s[:2]) * 60 + int(s[2:])
        return hhmm(match.group(1)), hhmm(match.group(2))
    return 0, 1439


def parse_time_hhmm(t: str) -> int:
    t = str(t).strip().zfill(4)
    return int(t[:2]) * 60 + int(t[2:])


def extract_lectures(description: str) -> list[dict]:
    """
    Use regex to pull lecture windows from a building description.
    Handles: "hosts X lectures from 1000 to 1200"
    and:      "hosts X lectures every day from 1000 to 1300"
    """
    pattern = re.compile(
        r"hosts\s+([\w\s]+?)\s+lectures?(?:\s+every\s+day)?\s+from\s+(\d{4})\s+to\s+(\d{4})",
        re.IGNORECASE,
    )
    lectures = []
    for m in pattern.finditer(description):
        lectures.append({
            "subject": m.group(1).strip().title(),
            "start":   parse_time_hhmm(m.group(2)),
            "end":     parse_time_hhmm(m.group(3)),
        })

    # Also handle "from 0900 to 1100 and ... from 1000 until 1200" multi-subject descriptions
    alt_pattern = re.compile(
        r"([\w\s]+?)\s+lectures?\s+from\s+(\d{4})\s+(?:to|until)\s+(\d{4})",
        re.IGNORECASE,
    )
    seen = {(l["subject"], l["start"]) for l in lectures}
    for m in alt_pattern.finditer(description):
        subject = m.group(1).strip().title()
        start   = parse_time_hhmm(m.group(2))
        if (subject, start) not in seen:
            lectures.append({
                "subject": subject,
                "start":   start,
                "end":     parse_time_hhmm(m.group(3)),
            })
            seen.add((subject, start))
    return lectures


def building_id(name: str) -> str:
    return re.sub(r"\W+", "_", name.lower()).strip("_")


def load_flags() -> pd.DataFrame:
    """
    Load all flag sources. Merges:
      - testimony_flags.csv      (Shradha — claims.py)
      - rules_flags.csv          (Bhushan — rules.py, if it exists)
    """
    frames = []
    testimony_path = RAW_DIR / "testimony_flags.csv"
    rules_path     = RAW_DIR / "rules_flags.csv"

    if testimony_path.exists():
        frames.append(pd.read_csv(testimony_path))
        print(f"[build] Loaded testimony flags: {len(frames[-1])} rows")
    else:
        print("[build] WARNING: testimony_flags.csv not found — run claims.py first")

    rules_json = RAW_DIR / "flags.json"   # what rules.py actually writes
    if rules_json.exists():
        frames.append(pd.read_json(rules_json))
        print(f"[build] Loaded rules flags: {len(frames[-1])} rows")
    elif rules_path.exists():
        frames.append(pd.read_csv(rules_path))
        print(f"[build] Loaded rules flags: {len(frames[-1])} rows")
    else:
        print("[build] NOTE: rules_flags.csv not found — Bhushan's rules.py hasn't run yet")

    if frames:
        return pd.concat(frames, ignore_index=True)
    return pd.DataFrame(columns=["student_id", "name", "rule", "severity", "detail"])


def load_claims() -> pd.DataFrame:
    path = RAW_DIR / "claims_extracted.csv"
    if path.exists():
        return pd.read_csv(path)
    print("[build] WARNING: claims_extracted.csv not found — run claims.py first")
    return pd.DataFrame()


# ── scoring ────────────────────────────────────────────────────────────────────

def compute_score(flags: list[dict]) -> float:
    """0–10 score from a list of flag dicts."""
    raw = sum(SEVERITY_WEIGHT.get(f.get("severity", "low"), 0.8) for f in flags)
    return round(min(raw, 10.0), 2)


# ── findings generator ─────────────────────────────────────────────────────────

def generate_findings(
    stays_df: pd.DataFrame,
    flags_df: pd.DataFrame,
    students_df: pd.DataFrame,
    G: nx.Graph,
    kingpin_id: str | None,
) -> list[dict]:
    """
    Produce ranked plain-English findings for the browser.
    """
    findings = []
    name_map = dict(zip(students_df["student_id"], students_df["name"]))

    # ── Finding type 1: night co-presence (most dramatic) ─────────────────────
    night_stays = stays_df[(stays_df["start"] < 360) | (stays_df["end"] < 360)]
    for place, grp in night_stays.groupby("place"):
        sids = grp["student_id"].unique().tolist()
        if len(sids) >= 2:
            start_min = int(grp["start"].min())
            end_min   = int(grp["end"].max())

            def fmt(m):
                return f"{m//60:02d}:{m%60:02d}"

            names = [name_map.get(s, s) for s in sids]
            findings.append({
                "rank":       1,
                "text":       (
                    f"{', '.join(names[:-1])} and {names[-1]} "
                    f"were all in {place.replace('_',' ').title()} together "
                    f"from {fmt(start_min)} to {fmt(end_min)}, "
                    f"when no university building is open."
                ),
                "time_start": start_min,
                "time_end":   end_min,
                "place":      place,
                "students":   sids,
            })

    # ── Finding type 2: high-severity individual flags ─────────────────────────
    high_flags = flags_df[flags_df["severity"] == "high"] if not flags_df.empty else pd.DataFrame()
    for _, row in high_flags.iterrows():
        sid  = str(row["student_id"])
        name = name_map.get(sid, sid)
        findings.append({
            "rank":       2,
            "text":       f"{name}: {row['detail']}",
            "time_start": None,
            "time_end":   None,
            "place":      None,
            "students":   [sid],
        })

    # ── Finding type 3: kingpin reveal ────────────────────────────────────────
    if kingpin_id:
        kname  = name_map.get(kingpin_id, kingpin_id)
        degree = G.degree(kingpin_id, weight="weight") if G.has_node(kingpin_id) else 0
        findings.append({
            "rank":       3,
            "text":       (
                f"{kname} has a spotless record — but is the only student "
                f"with co-presence links to all flagged suspects "
                f"(weighted degree: {round(degree, 2)}). "
                f"Network analysis identifies them as the likely mastermind."
            ),
            "time_start": None,
            "time_end":   None,
            "place":      None,
            "students":   [kingpin_id],
        })

    # Sort: rank 1 first, then by text length (shorter = punchier = first)
    findings.sort(key=lambda f: (f["rank"], len(f["text"])))

    # Assign final rank numbers
    for i, f in enumerate(findings):
        f["rank"] = i + 1

    return findings


# ── assemble data.json ─────────────────────────────────────────────────────────

def run():
    print("[build] Loading data...")
    students_raw  = load_students()
    buildings_raw = load_buildings()
    stays_df      = load_stays()
    flags_df      = load_flags()
    claims_df     = load_claims()

    # Re-run graph so we have the NetworkX object for findings
    G, kingpin_id = build_graph(stays_df, flags_df if not flags_df.empty else None)

    print(f"[build] Kingpin: {kingpin_id}")

    # ── buildings ──────────────────────────────────────────────────────────────
    buildings_out = []
    for _, row in buildings_raw.iterrows():
        lat, lng   = parse_latlon(row["Geolocation"])
        opens, closes = parse_opening(row["Opening Times"])
        bid        = building_id(str(row["Building Name"]))
        lectures   = extract_lectures(str(row.get("Description", "")))
        buildings_out.append({
            "id":        bid,
            "name":      str(row["Building Name"]).strip(),
            "lat":       lat,
            "lng":       lng,
            "opens":     opens,
            "closes":    closes,
            "lectures":  lectures,
            "isOutdoor": False,
        })

    # Add outdoor / off-campus places that appear in logs
    campus_ids = {b["id"] for b in buildings_out}
    for place in stays_df["place"].unique():
        pid = building_id(place)
        if pid not in campus_ids:
            buildings_out.append({
                "id":        pid,
                "name":      place.strip().title(),
                "lat":       0.0,
                "lng":       0.0,
                "opens":     0,
                "closes":    1439,
                "lectures":  [],
                "isOutdoor": True,
            })
            campus_ids.add(pid)

    # ── students ───────────────────────────────────────────────────────────────
    students_out = []
    flags_by_sid  = (
        flags_df.groupby("student_id")
        .apply(lambda g: g[["rule", "severity", "detail"]].to_dict("records"))
        .to_dict()
        if not flags_df.empty else {}
    )
    stays_by_sid = {}
    for sid, grp in stays_df.groupby("student_id"):
        recs = grp[["place", "start", "end"]].to_dict("records")
        stays_by_sid[sid] = [
            {
                "place": str(r["place"]),
                "start": int(r["start"]) if pd.notna(r["start"]) else None,
                "end":   int(r["end"])   if pd.notna(r["end"])   else None,
            }
            for r in recs
        ]

    claims_by_sid = {}
    if not claims_df.empty:
        clean_claims = claims_df.rename(columns={
            "place_claimed":     "place",
            "society_mentioned": "society",
        })
        for sid, grp in clean_claims.groupby("student_id"):
            recs = grp[["place", "start", "end", "activity", "society"]].to_dict("records")
            clean_recs = []
            for r in recs:
                clean_recs.append({
                    "place":    str(r["place"]) if pd.notna(r["place"]) else None,
                    "start":    int(r["start"]) if pd.notna(r["start"]) else None,
                    "end":      int(r["end"])   if pd.notna(r["end"])   else None,
                    "activity": str(r["activity"]) if pd.notna(r["activity"]) else None,
                    "society":  str(r["society"])  if pd.notna(r["society"])  else None,
                })
            claims_by_sid[sid] = clean_recs

    # Load testimonies for the card view
    testimonies: dict[str, str] = {}
    stmt_path = RAW_DIR / "student_statements.txt"
    if stmt_path.exists():
        text   = stmt_path.read_text(encoding="utf-8", errors="replace")
        blocks = re.split(r"Statement\s+\d+", text, flags=re.IGNORECASE)
        for block in blocks:
            sid_match  = re.search(r"Student\s+Number[:\s]+(\S+)", block, re.IGNORECASE)
            test_match = re.search(r"Testimony[:\s]+([\s\S]+)", block, re.IGNORECASE)
            if sid_match and test_match:
                sid = sid_match.group(1).strip().upper()
                testimonies[sid] = test_match.group(1).strip()

    # Load LLM reasoning from cache
    llm_reasoning: dict[str, str] = {}
    cache_dir = RAW_DIR / "llm_cache"
    if cache_dir.exists():
        for cache_file in cache_dir.glob("*.json"):
            sid = cache_file.stem.upper()
            try:
                cached = json.loads(cache_file.read_text(encoding="utf-8"))
                # Store the raw LLM output as reasoning text
                llm_reasoning[sid] = json.dumps(cached.get("claims", []), indent=2)
            except Exception:
                pass

    for _, row in students_raw.iterrows():
        sid    = str(row["student_id"])
        flags  = flags_by_sid.get(sid, [])
        score  = compute_score(flags)

        try:
            parsed_soc = ast.literal_eval(str(row["Societies"]))
            societies = list(parsed_soc) if isinstance(parsed_soc, (set, list, tuple)) else []
        except Exception:
            societies = []

        students_out.append({
            "id":            sid,
            "name":          row["name"],
            "age":           int(row["Age"]) if pd.notna(row.get("Age")) else None,
            "sex":           str(row.get("Sex", "")).strip(),
            "year":          int(row["Year of Study"]) if pd.notna(row.get("Year of Study")) else None,
            "subject":       str(row.get("Subject", "")).strip(),
            "height":        int(row["Height"]) if pd.notna(row.get("Height")) else None,
            "hair":          str(row.get("Hair colour", "#888888")).strip(),
            "societies":     societies,
            "score":         score,
            "flagged":       score > 2.0,
            "isKingpin":     sid == kingpin_id,
            "flags":         flags,
            "stays":         stays_by_sid.get(sid, []),
            "claims":        claims_by_sid.get(sid, []),
            "testimony":     testimonies.get(sid, ""),
            "llm_reasoning": llm_reasoning.get(sid, ""),
        })

    # Sort by score descending so browser gets pre-ranked list
    students_out.sort(key=lambda s: s["score"], reverse=True)

    # ── edges ──────────────────────────────────────────────────────────────────
    edges_out = []
    for a, b, data in G.edges(data=True):
        edges_out.append({
            "a":           a,
            "b":           b,
            "weight":      round(data.get("weight", 0), 4),
            "overlap_min": int(data.get("overlap_min", 0)),
            "place":       str(data.get("place", "")),
        })

    # ── findings ───────────────────────────────────────────────────────────────
    findings = generate_findings(stays_df, flags_df, students_raw, G, kingpin_id)

    # ── assemble ───────────────────────────────────────────────────────────────
    output = {
        "meta": {
            "generated": pd.Timestamp.now().isoformat(),
            "version":   1,
            "case":      "Boyd Orr Burndown",
        },
        "buildings": buildings_out,
        "students":  students_out,
        "edges":     edges_out,
        "findings":  findings,
        "kingpin":   kingpin_id,
    }

    out_path = WEB_DIR / "data.json"
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"\n[build] Written -> {out_path}")
    print(f"[build]    {len(buildings_out)} buildings")
    print(f"[build]    {len(students_out)} students")
    print(f"[build]    {len(edges_out)} edges")
    print(f"[build]    {len(findings)} findings")
    print(f"[build]    kingpin = {kingpin_id}")


if __name__ == "__main__":
    run()
