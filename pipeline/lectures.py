import re
import pandas as pd

# The subjects we are looking for (Veterinary Medicine must come before Medicine)
SUBJECTS = "Computing Science|Engineering|Business|Philosophy|Veterinary Medicine|Mathematics|Medicine|English Literature|Chemistry|Physics"

# created a pattern which has a string and tells about the sentence shape e.g. "Business lectures from 1000 to 1100"
PATTERN = "(" + SUBJECTS + r") lectures (?:every day )?from (\d{4}) (?:to|until) (\d{4})"


def to_minutes(hhmm):
    # "1000" -> 10 hours * 60 + 0 minutes = 600
    return int(hhmm[:2]) * 60 + int(hhmm[2:])


def get_lectures(path="data/location_data.csv"):
    """Return a table with columns: building, subject, start_min, end_min."""
    locations = pd.read_csv(path)
    rows = []
    for _, row in locations.iterrows():
        found = re.findall(PATTERN, row["Description"], flags=re.IGNORECASE)
        for subject, start, end in found:
            rows.append({
                "building": row["Building Name"],
                "subject": subject.title(),
                "start_min": to_minutes(start),
                "end_min": to_minutes(end),
            })
    return pd.DataFrame(rows)


# This block only runs when you run THIS file directly, not when another file imports it
if __name__ == "__main__":
    print(get_lectures())