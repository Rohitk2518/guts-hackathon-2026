"""
claims.py — Stage 3 of the pipeline.
Owner: Shradha

Reads:
  - data/student_statements.txt   (raw testimonies)
  - data/people_data.csv          (student societies, via Rohit's ingest or directly)

Does:
  - Sends each testimony to NVIDIA NIM (LLM) with a strict JSON schema
  - Caches every response to data/llm_cache/<student_id>.json immediately
  - Re-runs read from cache — NEVER calls the API twice for the same student
  - Cross-checks claims against security log stays (TESTIMONY rule)
  - Outputs claims_df and testimony_flags_df for build.py

Usage:
  python pipeline/claims.py
  python pipeline/claims.py --force   # ignores cache, re-calls API
"""

import os
import re
import json
import time
import argparse
import ast
from pathlib import Path

import pandas as pd
from openai import OpenAI
from dotenv import load_dotenv

# ── config ─────────────────────────────────────────────────────────────────────
load_dotenv()

API_KEY   = os.getenv("NVIDIA_API_KEY")
BASE_URL  = "https://integrate.api.nvidia.com/v1"
MODEL     = "nvidia/nemotron-3.5-super-vl-120b-a12b"

client = OpenAI(
    base_url=BASE_URL,
    api_key=API_KEY,
)

ROOT_DIR  = Path(__file__).resolve().parent.parent
RAW_DIR   = ROOT_DIR / "data"
CACHE_DIR = RAW_DIR / "llm_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ── JSON schema the LLM must return ────────────────────────────────────────────
SYSTEM_PROMPT = """You are a forensic analyst. Extract every place, time and activity claim
from the student testimony below. Return ONLY a JSON object — no prose, no markdown.

Schema:
{
  "claims": [
    {
      "place":    "<building name or area as mentioned>",
      "start":    <integer minutes after midnight, e.g. 600 for 10:00, or null if unknown>,
      "end":      <integer minutes after midnight, or null if unknown>,
      "activity": "<what they claim to be doing>",
      "society":  "<society name if mentioned, else null>"
    }
  ],
  "overnight_absence": <true if they claim to have been home all night, else false>
}

Rules:
- Convert times: "10am"→600, "9am"→540, "lunch"→720, "afternoon"→840, "evening"→1080, "night"→1320
- "right after X" means add 15 minutes to X's end time
- If a time range is given like "10 to 12", use start=600 end=720
- Extract ALL locations mentioned, even brief ones like "Tesco" or "the park"
- If no time is given for a place, set start and end to null
"""

# ── helpers ────────────────────────────────────────────────────────────────────

def parse_time_hhmm(t: str) -> int:
    """Convert 'HHMM' string to minutes after midnight."""
    t = t.strip().zfill(4)
    return int(t[:2]) * 60 + int(t[2:])


def parse_statements(filepath: Path) -> list[dict]:
    """
    Parse student_statements.txt into a list of
    { student_id, name, testimony } dicts.
    """
    text = filepath.read_text(encoding="utf-8", errors="replace")
    blocks = re.split(r"Statement\s+\d+", text, flags=re.IGNORECASE)
    students = []
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        sid_match  = re.search(r"Student\s+Number[:\s]+(\S+)", block, re.IGNORECASE)
        name_match = re.search(r"Name[:\s]+(.+)", block, re.IGNORECASE)
        test_match = re.search(r"Testimony[:\s]+([\s\S]+)", block, re.IGNORECASE)
        if not (sid_match and test_match):
            continue
        students.append({
            "student_id": sid_match.group(1).strip().upper(),
            "name":       name_match.group(1).strip() if name_match else "Unknown",
            "testimony":  test_match.group(1).strip(),
        })
    print(f"[claims] Parsed {len(students)} testimonies from {filepath}")
    return students


def call_llm(testimony: str) -> dict:
    """Send testimony to NVIDIA NIM via OpenAI client with streaming, return parsed JSON dict."""
    completion = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": testimony},
        ],
        temperature=0.1,
        top_p=0.95,
        max_tokens=4096,
        extra_body={"chat_template_kwargs": {"enable_thinking": True}},
        stream=True,
    )

    full_content = []
    full_reasoning = []
    for chunk in completion:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta.content is not None:
            full_content.append(delta.content)
        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning:
            full_reasoning.append(reasoning)

    content = "".join(full_content).strip()
    reasoning = "".join(full_reasoning).strip()

    # If content is empty, try reasoning_content
    raw_text = content if content else reasoning

    # Remove any thinking block if present
    raw_text = re.sub(r"<thought>[\s\S]*?</thought>", "", raw_text, flags=re.IGNORECASE).strip()
    raw_text = re.sub(r"<think>[\s\S]*?</think>", "", raw_text, flags=re.IGNORECASE).strip()

    # Strip markdown code fences if wrapped
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
    if fence:
        candidate = fence.group(1).strip()
    else:
        obj = re.search(r"(\{[\s\S]*\})", raw_text)
        candidate = obj.group(1).strip() if obj else raw_text

    return json.loads(candidate)


def get_claims(student_id: str, testimony: str, force: bool = False) -> dict:
    """
    Return cached LLM result or call API.
    Always writes to cache before returning.
    """
    cache_file = CACHE_DIR / f"{student_id}.json"

    if not force and cache_file.exists():
        print(f"[claims] cache hit  -> {student_id}")
        return json.loads(cache_file.read_text(encoding="utf-8"))

    print(f"[claims] calling API -> {student_id}")
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            result = call_llm(testimony)
            # ── WRITE CACHE IMMEDIATELY ──────────────────────────────────────────────
            cache_file.write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(f"[claims] cached      -> {cache_file}")
            return result
        except Exception as e:
            last_err = e
            print(f"[claims] attempt {attempt+1} failed for {student_id}: {e}")
            time.sleep(2)

    if last_err is not None:
        raise last_err
    raise RuntimeError(f"Failed to get claims for {student_id}")


# ── TESTIMONY rule checks ───────────────────────────────────────────────────────

def load_stays(security_log_path: Path) -> pd.DataFrame:
    """
    Load security_logs.csv → stays DataFrame with int start/end minutes.
    Works even if Rohit's ingest.py hasn't run yet.
    """
    df = pd.read_csv(security_log_path)
    df.columns = df.columns.str.strip()

    def parse_time_range(t):
        t = str(t).strip()
        match = re.match(r"(\d{4})-(\d{4})", t)
        if match:
            return parse_time_hhmm(match.group(1)), parse_time_hhmm(match.group(2))
        return None, None

    df[["start", "end"]] = df["Time"].apply(
        lambda t: pd.Series(parse_time_range(t))
    )
    df["student_id"] = df["Student ID"].str.strip().str.upper()
    df["place_raw"]  = df["Location"].str.strip()
    return df[["student_id", "place_raw", "start", "end"]].dropna()


def load_societies(people_path: Path) -> dict[str, list[str]]:
    """Return { student_id: [society, ...] } from people_data.csv."""
    df = pd.read_csv(people_path)
    df.columns = df.columns.str.strip()
    df["student_id"] = df["Student ID"].str.strip().str.upper()
    result = {}
    for _, row in df.iterrows():
        try:
            societies = ast.literal_eval(str(row["Societies"]))
        except Exception:
            societies = []
        result[row["student_id"]] = [s.strip().lower() for s in societies]
    return result


def check_testimony_flags(
    student_id: str,
    claims: list[dict],
    stays_df: pd.DataFrame,
    societies: list[str],
) -> list[dict]:
    """
    Cross-check claims against actual stays.
    Returns list of TESTIMONY flags.
    """
    flags = []
    student_stays = stays_df[stays_df["student_id"] == student_id]

    for claim in claims:
        place    = (claim.get("place") or "").lower()
        c_start  = claim.get("start")
        c_end    = claim.get("end")
        society  = claim.get("society")

        # Rule: society claimed but not registered
        if society:
            if society.lower() not in societies:
                flags.append({
                    "rule":     "TESTIMONY",
                    "severity": "medium",
                    "detail":   f"Claimed '{society}' but student is not a registered member",
                })

        # Rule: claim has a time window but no matching log entry
        if c_start is not None and c_end is not None:
            overlapping = student_stays[
                (student_stays["start"] <= c_end) &
                (student_stays["end"]   >= c_start)
            ]
            if overlapping.empty:
                flags.append({
                    "rule":     "TESTIMONY",
                    "severity": "high",
                    "detail":   (
                        f"Claimed to be at '{claim.get('place')}' "
                        f"{int(c_start)//60:02d}:{int(c_start)%60:02d}-"
                        f"{int(c_end)//60:02d}:{int(c_end)%60:02d} "
                        f"but no security log entry found"
                    ),
                })

    return flags


# ── main ───────────────────────────────────────────────────────────────────────

def run(force: bool = False) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Run claim extraction for all students.

    Returns:
        claims_df       — one row per claim per student
        testimony_flags — one row per TESTIMONY flag
    """
    if not API_KEY:
        raise EnvironmentError(
            "NVIDIA_API_KEY not set. Add it to your .env file."
        )

    statements  = parse_statements(RAW_DIR / "student_statements.txt")
    stays_df    = load_stays(RAW_DIR / "security_logs.csv")
    societies   = load_societies(RAW_DIR / "people_data.csv")

    all_claims  = []
    all_flags   = []

    for s in statements:
        sid = s["student_id"]

        # ── get LLM result (cache or API) ─────────────────────────────────────
        try:
            result = get_claims(sid, s["testimony"], force=force)
        except Exception as e:
            print(f"[claims] ERROR for {sid}: {e}")
            result = {"claims": [], "overnight_absence": False}

        claims_raw = result.get("claims", [])

        # ── store each claim as a row ─────────────────────────────────────────
        for c in claims_raw:
            all_claims.append({
                "student_id":       sid,
                "name":             s["name"],
                "place_claimed":    c.get("place"),
                "start":            c.get("start"),
                "end":              c.get("end"),
                "activity":         c.get("activity"),
                "society_mentioned":c.get("society"),
            })

        # ── run TESTIMONY rule checks ─────────────────────────────────────────
        student_societies = societies.get(sid, [])
        flags = check_testimony_flags(sid, claims_raw, stays_df, student_societies)
        for f in flags:
            f["student_id"] = sid
            f["name"]       = s["name"]
        all_flags.extend(flags)

        print(f"[claims] {sid} — {len(claims_raw)} claims, {len(flags)} testimony flags")

    claims_df  = pd.DataFrame(all_claims)
    flags_df   = pd.DataFrame(all_flags) if all_flags else pd.DataFrame(
        columns=["student_id", "name", "rule", "severity", "detail"]
    )

    # Save intermediates so graph.py and build.py can load them without re-running
    claims_df.to_csv(RAW_DIR / "claims_extracted.csv", index=False)
    flags_df.to_csv(RAW_DIR  / "testimony_flags.csv",  index=False)
    print(f"\n[claims] Done. {len(claims_df)} claims, {len(flags_df)} testimony flags")
    print(f"[claims] Saved -> data/claims_extracted.csv")
    print(f"[claims] Saved -> data/testimony_flags.csv")

    return claims_df, flags_df


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true",
                        help="Ignore cache and re-call the API for every student")
    args = parser.parse_args()
    run(force=args.force)
