import json
from itertools import combinations

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


def check_teleport(stays):
    """Rule TELEPORT: flag a student logged in two places at the same time."""
    flags = []
    for student_id, group in stays.groupby("student_id"):
        for (_, a), (_, b) in combinations(group.iterrows(), 2):
            # Two time ranges overlap if each one starts before the other ends
            if a["check_in_minutes"] < b["check_out_minutes"] and b["check_in_minutes"] < a["check_out_minutes"]:
                overlap = min(a["check_out_minutes"], b["check_out_minutes"]) - max(a["check_in_minutes"], b["check_in_minutes"])
                flags.append({
                    "student_id": student_id,
                    "name": a["name"],
                    "rule": "TELEPORT",
                    "severity": "high",
                    "detail": f"{a['location']} ({a['time']}) overlaps {b['location']} ({b['time']}) by {overlap} min",
                })
    return flags


def check_identity(stays, people):
    """Rule IDENTITY: a student ID in the log that is missing from the student table."""
    flags = []
    known_ids = set(people["student_id"])
    for student_id, group in stays.groupby("student_id"):
        if student_id in known_ids:
            continue
        name = group["name"].iloc[0]
        same_name = people[people["name"] == name]
        if len(same_name) == 1:
            hint = f"the student table lists {name} as {same_name['student_id'].iloc[0]}"
        else:
            hint = "no student in the table has this name"
        flags.append({
            "student_id": student_id,
            "name": name,
            "rule": "IDENTITY",
            "severity": "medium",
            "detail": f"Log ID {student_id} is not in the student table ({hint})",
        })
    return flags


def check_age(stays, people):
    """Rule AGE: under-18s must not be in The Hive (over 18s only)."""
    flags = []
    young = people[people["age"] < 18].set_index("student_id")
    hive = stays[stays["location"] == "The Hive"]
    for _, stay in hive.iterrows():
        if stay["student_id"] in young.index:
            age = int(young.loc[stay["student_id"], "age"])
            flags.append({
                "student_id": stay["student_id"],
                "name": stay["name"],
                "rule": "AGE",
                "severity": "high",
                "detail": f"Aged {age} but logged in The Hive ({stay['time']}), which is over 18s only",
            })
    return flags


def run_all_rules():
    """Run every rule and return one combined list of flags."""
    stays = load_stays()
    hours = load_building_hours()
    people = load_people()
    lectures = get_lectures()
    return (check_out_of_hours(stays, hours)
            + check_lectures(stays, people, lectures)
            + check_teleport(stays)
            + check_identity(stays, people)
            + check_age(stays, people))


def save_flags(flags, path="data/flags.json"):
    """Save the flags to a file so other teammates can load them without running our code."""
    with open(path, "w") as f:
        json.dump(flags, f, indent=2)


if __name__ == "__main__":
    flags = run_all_rules()
    save_flags(flags)
    students = {f["student_id"] for f in flags}
    print(f"Saved {len(flags)} flags for {len(students)} students to data/flags.json")