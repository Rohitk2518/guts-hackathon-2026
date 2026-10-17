import pandas as pd
from lectures import to_minutes


def load_stays(path="data/security_logs.csv"):
    """TEMPORARY loader (until Rohit's ingest.py is ready)."""
    logs = pd.read_csv(path)
    logs["start_min"] = logs["Time"].str[:4].apply(to_minutes)
    logs["end_min"] = logs["Time"].str[5:].apply(to_minutes)
    # If a stay ends "before" it starts, it went past midnight, so add 24 hours
    logs.loc[logs["end_min"] <= logs["start_min"], "end_min"] += 1440
    return logs


def load_building_hours(path="data/location_data.csv"):
    """Return a dictionary: building name -> (opens_min, closes_min)."""
    locations = pd.read_csv(path)
    hours = {}
    for _, row in locations.iterrows():
        text = row["Opening Times"]
        opens = to_minutes(text[:4])
        closes = to_minutes(text[5:])
        if text == "0000-0000":
            closes = 2880  # always open (the park)
        elif closes <= opens:
            closes += 1440  # closes after midnight
        hours[row["Building Name"]] = (opens, closes)
    return hours


# if __name__ == "__main__":
#     for name, (opens, closes) in load_building_hours().items():
#         print(name, opens, closes)

# Spelling fixes (temporary, until Rohit's alias lists exist)
LOCATION_FIXES = {"Queen Maragret Building": "Queen Margaret Union"}


def check_out_of_hours(stays, hours):
    """Rule OOH: flag any stay in a building outside its opening hours."""
    flags = []
    for _, stay in stays.iterrows():
        place = LOCATION_FIXES.get(stay["Location"], stay["Location"])
        opens, closes = hours[place]
        # Normal case: the whole stay fits inside the opening window
        fits_today = stay["start_min"] >= opens and stay["end_min"] <= closes
        # After-midnight stays belong to the previous evening's opening window
        fits_late = stay["start_min"] + 1440 >= opens and stay["end_min"] + 1440 <= closes
        if not (fits_today or fits_late):
            flags.append({
                "student_id": stay["Student ID"],
                "name": stay["Name"],
                "rule": "OOH",
                "severity": "high",
                "detail": f"In {place} {stay['Time']}, outside opening hours",
            })
    return flags


if __name__ == "__main__":
    stays = load_stays()
    hours = load_building_hours()
    flags = check_out_of_hours(stays, hours)
    print("OOH flags:", len(flags))
    for f in flags:
        print(f)