import pandas as pd


def load_stays(path="data/security_logs_clean.csv"):
    """Load Rohit's cleaned security log (times already in minutes)."""
    return pd.read_csv(path)


def load_building_hours(path="data/location_clean.csv"):
    """Return a dictionary: building name -> (opens_min, closes_min)."""
    locations = pd.read_csv(path)
    hours = {}
    for _, row in locations.iterrows():
        opens, closes = int(row["opens"]), int(row["closes"])
        if opens == 0 and closes == 1440:
            closes = 2880  # always open (the park), even after midnight
        hours[row["building_name"]] = (opens, closes)
    return hours


def check_out_of_hours(stays, hours):
    """Rule OOH: flag any stay in a building outside its opening hours."""
    flags = []
    for _, stay in stays.iterrows():
        place = stay["location"]
        opens, closes = hours[place]
        start, end = stay["check_in_minutes"], stay["check_out_minutes"]
        # Normal case: the whole stay fits inside the opening window
        fits_today = start >= opens and end <= closes
        # After-midnight stays belong to the previous evening's opening window
        fits_late = start + 1440 >= opens and end + 1440 <= closes
        if not (fits_today or fits_late):
            flags.append({
                "student_id": stay["student_id"],
                "name": stay["name"],
                "rule": "OOH",
                "severity": "high",
                "detail": f"In {place} {stay['time']}, outside opening hours",
            })
    return flags


if __name__ == "__main__":
    stays = load_stays()
    hours = load_building_hours()
    flags = check_out_of_hours(stays, hours)
    print("OOH flags:", len(flags))
    for f in flags:
        print(f)