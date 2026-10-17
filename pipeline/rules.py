import pandas as pd
from lectures import get_lectures


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


def load_people(path="data/people_clean.csv"):
    """Load Rohit's cleaned student table."""
    return pd.read_csv(path)


def check_lectures(stays, people, lectures):
    """Rule LECTURE: every student must attend their subject's lecture once."""
    flags = []
    for _, person in people.iterrows():
        subject = person["subject"]
        wanted = lectures[lectures["subject"] == subject]
        if wanted.empty:
            # We cannot check this student, so this is information, not an accusation
            flags.append({
                "student_id": person["student_id"],
                "name": person["name"],
                "rule": "LECTURE",
                "severity": "low",
                "detail": f"No lecture is listed for {subject}, so attendance cannot be checked",
            })
            continue
        lecture = wanted.iloc[0]
        mine = stays[(stays["student_id"] == person["student_id"])
                     & (stays["location"] == lecture["building"])]
        # Attended = a stay in the right building that overlaps the lecture window
        attended = ((mine["check_in_minutes"] < lecture["end_min"])
                    & (mine["check_out_minutes"] > lecture["start_min"])).any()
        if not attended:
            flags.append({
                "student_id": person["student_id"],
                "name": person["name"],
                "rule": "LECTURE",
                "severity": "high",
                "detail": f"No stay in {lecture['building']} during the {subject} lecture ({lecture['start_min']}-{lecture['end_min']} min)",
            })
    return flags


if __name__ == "__main__":
    stays = load_stays()
    hours = load_building_hours()
    people = load_people()
    lectures = get_lectures()
    flags = check_out_of_hours(stays, hours) + check_lectures(stays, people, lectures)
    print("Total flags:", len(flags))
    for f in flags:
        print(f)