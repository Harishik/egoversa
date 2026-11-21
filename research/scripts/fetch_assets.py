#!/usr/bin/env python3
"""Download the realistic assets used by EgoVersa-Sim into research/assets/ (not committed; re-runnable).

    python research/scripts/fetch_assets.py            # everything
    python research/scripts/fetch_assets.py --check    # verify what is present

Sources and licences (also written to research/assets/ATTRIBUTION.md):
  objects   Google Scanned Objects (Downs et al., ICRA 2022, CC BY 4.0), MuJoCo conversion by
            kevinzakka/mujoco_scanned_objects (MIT): textured visual mesh + convex collision parts
  robots    MuJoCo Menagerie (google-deepmind/mujoco_menagerie): Unitree G1 (BSD-3-Clause),
            Hello Robot Stretch 3 (Apache-2.0)
  textures  Poly Haven (CC0): table and floor materials
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "research" / "assets"
GSO_REPO = "kevinzakka/mujoco_scanned_objects"
MENAGERIE = "google-deepmind/mujoco_menagerie"
RAW = "https://raw.githubusercontent.com/{repo}/main/{path}"
API = "https://api.github.com/repos/{repo}/contents/{path}"

# folder -> (display name, noun). Display names describe what the object looks like; they are verified
# against a rendered contact sheet (research/assets/contact_sheet.png) and corrected by hand where needed.
OBJECTS = {
    "Cole_Hardware_Mug_Classic_Blue": ("blue mug", "mug"),
    "Room_Essentials_Mug_White_Yellow": ("yellow mug", "mug"),
    "Threshold_Porcelain_Coffee_Mug_All_Over_Bead_White": ("white mug", "mug"),
    "Threshold_Porcelain_Teapot_White": ("white teapot", "teapot"),
    "Room_Essentials_Bowl_Turquiose": ("turquoise bowl", "bowl"),
    "Threshold_Bead_Cereal_Bowl_White": ("white bowl", "bowl"),
    "Top_Paw_Dog_Bowl_Blue_Paw_Bone_Ceramic_25_fl_oz_total": ("blue dog bowl", "dog bowl"),
    "Room_Essentials_Salad_Plate_Turquoise": ("turquoise plate", "plate"),
    "Threshold_Bistro_Ceramic_Dinner_Plate_Ruby_Ring": ("white plate", "plate"),
    "JBL_Charge_Speaker_portable_wireless_wired_Green": ("green speaker", "speaker"),
    "Logitech_Ultimate_Ears_Boom_Wireless_Speaker_Night_Black": ("black speaker", "speaker"),
    "Crosley_Alarm_Clock_Vintage_Metal": ("alarm clock", "clock"),
    "Mens_Striper_Sneaker_in_White_rnp8HUli59Y": ("white sneaker", "sneaker"),
    "Timberland_Mens_Classic_2Eye_Boat_Shoe": ("brown shoe", "shoe"),
    "Sapota_Threshold_4_Ceramic_Round_Planter_Red": ("red planter", "planter"),
    "Ecoforms_Plant_Pot_GP9AAvocado": ("green flowerpot", "flowerpot"),
    "Great_Dinos_Triceratops_Toy": ("toy dinosaur", "toy dinosaur"),
    "Schleich_Lion_Action_Figure": ("toy lion", "toy lion"),
    "Schleich_African_Black_Rhino": ("toy rhino", "toy rhino"),
    "Shurtape_Tape_Purple_CP28": ("purple tape roll", "tape roll"),
    "3M_Vinyl_Tape_Green_1_x_36_yd": ("green tape roll", "tape roll"),
    "Vans_Cereal_Honey_Nut_Crunch_11_oz_box": ("cereal box", "box"),
    "Olive_Kids_Dinosaur_Land_Lunch_Box": ("lunch box", "lunch box"),
    "Victor_Reversible_Bookend": ("bookend", "bookend"),
    "Android_Figure_Panda": ("panda figure", "figure"),
    "Spritz_Easter_Basket_Plastic_Teal": ("teal basket", "basket"),
    "Ecoforms_Plant_Bowl_Turquoise_7": ("turquoise plant bowl", "plant bowl"),
    "Cole_Hardware_Mug_Classic_Blue_DUPLICATE_GUARD": None,
}
OBJECTS.pop("Cole_Hardware_Mug_Classic_Blue_DUPLICATE_GUARD")
ROBOTS = {"unitree_g1": ("g1.xml", "BSD-3-Clause"), "hello_robot_stretch_3": ("stretch.xml", "Apache-2.0")}
TEXTURES = {"table": "wood_table_001", "floor": "laminate_floor_02"}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "egoversa-asset-fetch"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def listdir(repo: str, path: str) -> list[dict]:
    return json.loads(get(API.format(repo=repo, path=path)))


def fetch_tree(repo: str, path: str, dest: Path, skip_ext: tuple = (".png",) ) -> int:
    n = 0
    for e in listdir(repo, path):
        if e["type"] == "dir":
            n += fetch_tree(repo, e["path"], dest / e["name"], skip_ext=())
        elif e["type"] == "file":
            if e["name"].endswith(skip_ext) and dest.name not in ("assets",):
                continue  # robot preview images are not needed
            out = dest / e["name"]
            if not out.exists() or out.stat().st_size != e["size"]:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(get(e["download_url"]))
            n += 1
    return n


def fetch_texture(name: str, slug: str) -> None:
    from PIL import Image

    files = json.loads(get(f"https://api.polyhaven.com/files/{slug}"))
    diff = files.get("Diffuse") or files.get("diffuse")
    url = (diff["1k"].get("png") or diff["1k"]["jpg"])["url"]
    img = Image.open(io.BytesIO(get(url))).convert("RGB").resize((1024, 1024))
    out = ASSETS / "textures" / f"{name}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        missing = [k for k in OBJECTS if not (ASSETS / "objects" / k / "model.obj").exists()]
        missing += [k for k, (x, _) in ROBOTS.items() if not (ASSETS / "robots" / k / x).exists()]
        missing += [k for k in TEXTURES if not (ASSETS / "textures" / f"{k}.png").exists()]
        print("all assets present" if not missing else f"missing: {missing}")
        return 0 if not missing else 1
    for folder, (name, _) in OBJECTS.items():
        dest = ASSETS / "objects" / folder
        files = [e for e in listdir(GSO_REPO, f"models/{folder}") if e["type"] == "file"]
        for e in files:
            out = dest / e["name"]
            if not out.exists() or out.stat().st_size != e["size"]:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(get(e["download_url"]))
        print(f"object  {name:22s} {len(files)} files")
    for robot, (xml, lic) in ROBOTS.items():
        n = fetch_tree(MENAGERIE, robot, ASSETS / "robots" / robot)
        print(f"robot   {robot:22s} {n} files ({lic})")
    for name, slug in TEXTURES.items():
        fetch_texture(name, slug)
        print(f"texture {name:22s} Poly Haven {slug} (CC0)")
    (ASSETS / "ATTRIBUTION.md").write_text(
        "# Asset attribution\n\n"
        "- Household objects: Google Scanned Objects, Downs et al., *Google Scanned Objects: A High-Quality Dataset of 3D Scanned Household Items*, ICRA 2022. CC BY 4.0. "
        f"MuJoCo conversion: https://github.com/{GSO_REPO} (MIT).\n"
        + "".join(f"  - `{k}` shown as \"{v[0]}\"\n" for k, v in OBJECTS.items())
        + f"- Robots: MuJoCo Menagerie, https://github.com/{MENAGERIE}: Unitree G1 (BSD-3-Clause, Unitree Robotics), Hello Robot Stretch 3 (Apache-2.0, Hello Robot Inc.).\n"
        + "".join(f"- Texture `{k}`: Poly Haven `{v}`, CC0, https://polyhaven.com/a/{v}\n" for k, v in TEXTURES.items())
    )
    print(f"assets in {ASSETS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
