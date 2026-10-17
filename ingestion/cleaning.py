import ast
import colorsys
import re
from pathlib import Path

import pandas as pd

data_dir = Path(__file__).resolve().parent.parent / "data"

location_df = pd.read_csv(data_dir / "location_data.csv")
people_df = pd.read_csv(data_dir / "people_data.csv")
security_logs_df = pd.read_csv(data_dir / "security_logs.csv")

# print("Location data:")
# print(location_df.head())

# print("People data:")
# print(people_df.head())

# print("Security logs:")
# print(security_logs_df.head())

for name, df in [("location", location_df), ("people", people_df), ("logs", security_logs_df)]:
    print(name, df.shape)
    print(df.dtypes)
    print(df.isna().sum())
    print("duplicate rows:", df.duplicated().sum())

# Standardize column names
for df in [location_df, people_df, security_logs_df]:
    df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_").str.replace("-", "_")
    df.columns = df.columns.str.replace(r"[^\w\s]", "", regex=True)
    print(df.columns)

people_df["student_id"] = people_df["student_id"].str.upper()
security_logs_df["student_id"] = security_logs_df["student_id"].str.upper()

qmu_aliases = {
    "Queen Margaret Union": "QMU",
    "Queen Maragret Building": "QMU",
}
location_df["building_name"] = location_df["building_name"].replace(qmu_aliases)
security_logs_df["location"] = security_logs_df["location"].replace(qmu_aliases)

subject_aliases = {
    "Computer Science": "Computing Science",
    "English Lit": "English Literature",
}
people_df["subject"] = people_df["subject"].replace(subject_aliases)
unusual_subjects = {"Business"}
people_df["is_unusual_subject"] = people_df["subject"].isin(unusual_subjects)


def name_hair_colour(value):
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
        raise ValueError(f"Expected a six-digit hex color, got {value!r}")

    red, green, blue = (int(value[index:index + 2], 16) / 255 for index in (1, 3, 5))
    hue, saturation, brightness = colorsys.rgb_to_hsv(red, green, blue)

    if saturation < 0.15:
        if brightness < 0.2:
            return "black"
        if brightness > 0.85:
            return "white"
        return "gray"
    if brightness < 0.45 and (hue < 0.12 or hue >= 0.95):
        return "brown"
    if saturation < 0.55 and brightness > 0.8 and (hue < 0.06 or hue >= 0.9):
        return "pink"
    if hue < 0.04 or hue >= 0.96:
        return "red"
    if hue < 0.1:
        return "orange"
    if hue < 0.17:
        return "yellow"
    if hue < 0.42:
        return "green"
    if hue < 0.53:
        return "cyan"
    if hue < 0.7:
        return "blue"
    if hue < 0.82:
        return "purple"
    if hue < 0.92:
        return "magenta"
    return "red"


people_df["hair_colour_name"] = people_df["hair_colour"].map(name_hair_colour)


def parse_societies(value):
    if isinstance(value, list):
        return value
    if pd.isna(value):
        return []

    societies = ast.literal_eval(value)
    if not isinstance(societies, (list, set)) or not all(isinstance(society, str) for society in societies):
        raise ValueError(f"Expected a list of society names, got {value!r}")
    return sorted(societies) if isinstance(societies, set) else societies


people_df["societies"] = people_df["societies"].map(parse_societies)

coordinates = location_df["geolocation"].str.strip("{}").str.split(expand=True)
location_df["latitude"] = pd.to_numeric(coordinates[0], errors="coerce")
location_df["longitude"] = pd.to_numeric(coordinates[1], errors="coerce")


def parse_opening_times(value):
    match = re.fullmatch(r"(\d{2})(\d{2})-(\d{2})(\d{2})", value)
    if match is None:
        raise ValueError(f"Expected opening times in HHMM-HHMM format, got {value!r}")

    start_hour, start_minute, end_hour, end_minute = map(int, match.groups())
    if start_hour > 23 or end_hour > 23 or start_minute > 59 or end_minute > 59:
        raise ValueError(f"Opening times contain an invalid time, got {value!r}")
    opens = start_hour * 60 + start_minute
    closes = end_hour * 60 + end_minute
    if closes <= opens:
        closes += 1440
    return opens, closes


location_df[["opens", "closes"]] = pd.DataFrame(
    location_df["opening_times"].map(parse_opening_times).tolist(),
    index=location_df.index,
)


def parse_check_times(value):
    match = re.fullmatch(r"(\d{2})(\d{2})-(\d{2})(\d{2})", value)
    if match is None:
        raise ValueError(f"Expected security log times in HHMM-HHMM format, got {value!r}")

    check_in_hour, check_in_minute, check_out_hour, check_out_minute = map(int, match.groups())
    if (
        check_in_hour > 23
        or check_out_hour > 23
        or check_in_minute > 59
        or check_out_minute > 59
    ):
        raise ValueError(f"Security log times contain an invalid time, got {value!r}")
    check_in_minutes = check_in_hour * 60 + check_in_minute
    check_out_minutes = check_out_hour * 60 + check_out_minute
    if check_out_minutes < check_in_minutes:
        check_out_minutes += 1440
    return check_in_minutes, check_out_minutes


security_logs_df[["check_in_minutes", "check_out_minutes"]] = pd.DataFrame(
    security_logs_df["time"].map(parse_check_times).tolist(),
    index=security_logs_df.index,
)

location_df.to_csv(data_dir / "location_clean.csv", index=False)
people_df.to_csv(data_dir / "people_clean.csv", index=False)
security_logs_df.to_csv(data_dir / "security_logs_clean.csv", index=False)

statements = (data_dir / "student_statements.txt").read_text(encoding="utf-8")
statements = re.sub(
    r"(?m)^(Student Number:\s*)([A-Za-z0-9]+)\s*$",
    lambda match: f"{match.group(1)}{match.group(2).upper()}",
    statements,
)
(data_dir / "student_statements_clean.txt").write_text(statements, encoding="utf-8")
