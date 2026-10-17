"""
aliases.py — canonical name maps shared by the whole pipeline.
Rohit owns this file. We import from it so both teams stay in sync.
If Rohit hasn't pushed his version yet, this stub keeps our code runnable.
"""

# Maps any variant spelling → single canonical subject name
SUBJECT_ALIASES: dict[str, str] = {
    "computer science": "Computing Science",
    "computing science": "Computing Science",
    "comp sci": "Computing Science",
    "maths": "Mathematics",
    "math": "Mathematics",
    "mathematics": "Mathematics",
    "physics": "Physics",
    "philosophy": "Philosophy",
    "english": "English Literature",
    "english literature": "English Literature",
    "engineering": "Engineering",
    "business": "Business",
    "vet med": "Veterinary Medicine",
    "veterinary medicine": "Veterinary Medicine",
    "sociology": "Sociology",
    "law": "Law",
    "chemistry": "Chemistry",
    "history": "History",
}

# Maps any variant building name → single canonical building id
BUILDING_ALIASES: dict[str, str] = {
    "boyd orr":           "boyd_orr",
    "boyd orr building":  "boyd_orr",
    "boydy":              "boyd_orr",
    "the boyd orr":       "boyd_orr",
    "james watt":         "james_watt",
    "james watt building":"james_watt",
    "adam smith":         "adam_smith",
    "adam smith building":"adam_smith",
    "main building":      "main_building",
    "the main building":  "main_building",
    "main":               "main_building",
    "library":            "library",
    "the library":        "library",
    "university library": "library",
    "qmu":                "qmu",
    "the union":          "qmu",
    "student union":      "qmu",
    "union":              "qmu",
    "queens margaret union": "qmu",
    "kelvin building":    "kelvin_building",
    "kelvin bldg":        "kelvin_building",
    "st andrews building":"st_andrews",
    "st. andrews":        "st_andrews",
    "joseph black":       "joseph_black",
    "joseph black building": "joseph_black",
    "kelvingrove park":   "kelvingrove_park",
    "kelvingrove":        "kelvingrove_park",
    "the park":           "kelvingrove_park",
    "kg":                 "kelvingrove_park",
    "kg skate park":      "kelvingrove_park",
    "hive":               "hive",
    "tesco":              "tesco",
    "home":               "home",
    "halls":              "home",
}


def normalise_subject(raw: str) -> str:
    """Return canonical subject name, or original if no alias found."""
    return SUBJECT_ALIASES.get(raw.strip().lower(), raw.strip())


def normalise_building(raw: str) -> str | None:
    """Return canonical building id, or None if unrecognised."""
    return BUILDING_ALIASES.get(raw.strip().lower(), None)
