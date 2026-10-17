"""
graph.py — Stage 5 of the pipeline.
Owner: Shradha

Reads:
  - data/security_logs.csv   (cleaned stays, or directly parsed here)

Does:
  - Builds co-presence graph using NetworkX
  - Two students share an edge if they overlap at the same location for >= MIN_OVERLAP_MIN
  - Edge weight = overlap_minutes / place_occupancy  (crowd correction)
  - Identifies the kingpin: low flag score + highest weighted degree

Outputs:
  - data/graph_edges.csv     (a, b, weight, overlap_min, place)
  - data/graph_scores.csv    (student_id, weighted_degree)
  - Returns (G, kingpin_id)

Usage:
  python pipeline/graph.py
"""

import re
from pathlib import Path

import pandas as pd
import networkx as nx

ROOT_DIR = Path(__file__).resolve().parent.parent
RAW_DIR  = ROOT_DIR / "data"

# Minimum co-presence overlap in minutes to count as a meaningful link
MIN_OVERLAP_MIN = 10

# Approximate occupancy of each location (used for crowd correction).
# Higher = more crowded = lower edge weight.
# Lecture halls link everyone — we downweight them heavily.
PLACE_OCCUPANCY: dict[str, int] = {
    "kelvingrove park":   30,
    "kelvingrove_park":   30,
    "qmu":               200,
    "the union":         200,
    "union":             200,
    "boyd orr building": 300,
    "boyd_orr":          300,
    "james watt building":150,
    "james_watt":        150,
    "adam smith building":120,
    "adam_smith":        120,
    "main building":     250,
    "main_building":     250,
    "library":           400,
    "kelvin building":   100,
    "kelvin_building":   100,
    "st andrews building":80,
    "st_andrews":         80,
    "joseph black building":120,
    "joseph_black":      120,
    "hive":              500,
    "tesco":             100,
    "home":                1,   # trivially — shouldn't create edges
}

DEFAULT_OCCUPANCY = 100


# ── helpers ────────────────────────────────────────────────────────────────────

def parse_time_hhmm(t: str) -> int:
    t = str(t).strip().zfill(4)
    return int(t[:2]) * 60 + int(t[2:])


def load_stays() -> pd.DataFrame:
    """
    Load security_logs.csv and return a tidy stays DataFrame.
    Runs independently — does not depend on Rohit's ingest.py output.
    """
    df = pd.read_csv(RAW_DIR / "security_logs.csv")
    df.columns = df.columns.str.strip()

    def parse_range(t):
        match = re.match(r"(\d{4})-(\d{4})", str(t).strip())
        if match:
            return parse_time_hhmm(match.group(1)), parse_time_hhmm(match.group(2))
        return None, None

    df[["start", "end"]] = df["Time"].apply(lambda t: pd.Series(parse_range(t)))
    df["student_id"]     = df["Student ID"].str.strip().str.upper()
    df["place"]          = df["Location"].str.strip().str.lower()

    return df[["student_id", "place", "start", "end"]].dropna()


def overlap_minutes(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    """Return how many minutes two time windows overlap (0 if none)."""
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def get_occupancy(place: str) -> int:
    place_lower = place.strip().lower()
    return PLACE_OCCUPANCY.get(place_lower, DEFAULT_OCCUPANCY)


# ── main graph builder ─────────────────────────────────────────────────────────

def build_graph(
    stays_df: pd.DataFrame,
    flags_df: pd.DataFrame | None = None,
) -> tuple[nx.Graph, str | None]:
    """
    Build a weighted co-presence graph.

    Args:
        stays_df:  DataFrame with [student_id, place, start, end]
        flags_df:  Optional DataFrame with [student_id, rule, severity, ...]
                   Used to compute flag scores for kingpin detection.

    Returns:
        G:          NetworkX graph
        kingpin_id: student_id of the likely mastermind
    """
    G = nx.Graph()

    # Add every student as a node
    for sid in stays_df["student_id"].unique():
        G.add_node(sid)

    # Compute flag scores if available
    flag_scores: dict[str, float] = {}
    if flags_df is not None and not flags_df.empty:
        severity_weight = {"high": 3.0, "medium": 2.0, "low": 1.0}
        for sid, grp in flags_df.groupby("student_id"):
            score = sum(
                severity_weight.get(str(row["severity"]).lower(), 1.0)
                for _, row in grp.iterrows()
            )
            flag_scores[sid] = min(score, 10.0)  # cap at 10

    # Group stays by place for efficient pair comparison
    for place, place_stays in stays_df.groupby("place"):
        if place in ("home", "tesco"):  # skip non-campus locations
            continue

        occupancy = get_occupancy(place)
        rows = place_stays.to_dict("records")

        # Compare every pair of students at this place
        for i in range(len(rows)):
            for j in range(i + 1, len(rows)):
                a, b = rows[i], rows[j]
                if a["student_id"] == b["student_id"]:
                    continue

                overlap = overlap_minutes(
                    a["start"], a["end"],
                    b["start"], b["end"],
                )
                if overlap < MIN_OVERLAP_MIN:
                    continue

                # Crowd-corrected weight
                weight = round(overlap / occupancy, 4)

                sid_a = a["student_id"]
                sid_b = b["student_id"]

                if G.has_edge(sid_a, sid_b):
                    # Accumulate weight and overlap across multiple places
                    G[sid_a][sid_b]["weight"]      += weight
                    G[sid_a][sid_b]["overlap_min"] += overlap
                else:
                    G.add_edge(sid_a, sid_b,
                               weight=weight,
                               overlap_min=overlap,
                               place=place)

    print(f"[graph] Built graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    # ── Kingpin detection ──────────────────────────────────────────────────────
    # The mastermind has a CLEAN record (low flag score) but high weighted degree
    # (many strong connections to flagged students).
    kingpin_id = None
    if G.number_of_nodes() > 0:
        weighted_degree = dict(G.degree(weight="weight"))

        # Score = weighted_degree / (1 + flag_score)
        # Clean students with many connections bubble to the top.
        suspicion_score = {
            sid: weighted_degree.get(sid, 0) / (1 + flag_scores.get(sid, 0))
            for sid in G.nodes()
        }
        if suspicion_score:
            kingpin_id = max(suspicion_score, key=suspicion_score.get)
            print(f"[graph] Kingpin candidate: {kingpin_id} "
                  f"(suspicion_score={suspicion_score[kingpin_id]:.3f}, "
                  f"flag_score={flag_scores.get(kingpin_id, 0):.1f})")

    return G, kingpin_id


def graph_to_edges_df(G: nx.Graph) -> pd.DataFrame:
    """Convert NetworkX graph to a flat DataFrame for build.py."""
    rows = []
    for a, b, data in G.edges(data=True):
        rows.append({
            "a":           a,
            "b":           b,
            "weight":      round(data.get("weight", 0), 4),
            "overlap_min": data.get("overlap_min", 0),
            "place":       data.get("place", ""),
        })
    return pd.DataFrame(rows)


# ── entry point ────────────────────────────────────────────────────────────────

def run() -> tuple[nx.Graph, str | None]:
    stays_df = load_stays()

    # Try to load testimony flags if claims.py has already run
    flags_path = RAW_DIR / "testimony_flags.csv"
    flags_df   = pd.read_csv(flags_path) if flags_path.exists() else None

    G, kingpin_id = build_graph(stays_df, flags_df)

    edges_df = graph_to_edges_df(G)
    edges_df.to_csv(RAW_DIR / "graph_edges.csv", index=False)
    print(f"[graph] Saved -> data/graph_edges.csv ({len(edges_df)} edges)")
    print(f"[graph] Kingpin: {kingpin_id}")

    return G, kingpin_id


if __name__ == "__main__":
    run()
