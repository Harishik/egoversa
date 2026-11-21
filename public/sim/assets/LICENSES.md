# Third-party assets in public/sim/assets

These files are derived from third-party 3D assets. They are not covered by the project's MIT licence; each keeps its own licence.

- `gso_*.bin` and `gso_*.jpg` hold meshes and downscaled textures (512 px) from **Google Scanned Objects**: Downs et al., *Google Scanned Objects: A High-Quality Dataset of 3D Scanned Household Items*, ICRA 2022. Licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). The MuJoCo conversion comes from https://github.com/kevinzakka/mujoco_scanned_objects (MIT). The format was changed to raw vertex/uv/index buffers; the geometry itself was not modified.
- `robot_humanoid_*.bin` hold the **Unitree G1** meshes from MuJoCo Menagerie, © Unitree Robotics, **BSD-3-Clause** (see `licenses/unitree_g1-BSD-3-Clause.txt`). They were simplified by vertex clustering (6 mm grid).
- `robot_stretch_*.bin` hold the **Hello Robot Stretch 3** meshes from MuJoCo Menagerie, © Hello Robot Inc., **Apache-2.0** (see `licenses/hello_robot_stretch_3-Apache-2.0.txt`). They were simplified by vertex clustering (6 mm grid).

The objects used by the household-object list are:
  - `Cole_Hardware_Mug_Classic_Blue` shown as "blue mug"
  - `Room_Essentials_Mug_White_Yellow` shown as "yellow mug"
  - `Threshold_Porcelain_Coffee_Mug_All_Over_Bead_White` shown as "white mug"
  - `Threshold_Porcelain_Teapot_White` shown as "white teapot"
  - `Room_Essentials_Bowl_Turquiose` shown as "turquoise bowl"
  - `Threshold_Bead_Cereal_Bowl_White` shown as "white bowl"
  - `Top_Paw_Dog_Bowl_Blue_Paw_Bone_Ceramic_25_fl_oz_total` shown as "blue dog bowl"
  - `Room_Essentials_Salad_Plate_Turquoise` shown as "turquoise plate"
  - `Threshold_Bistro_Ceramic_Dinner_Plate_Ruby_Ring` shown as "white plate"
  - `JBL_Charge_Speaker_portable_wireless_wired_Green` shown as "green speaker"
  - `Logitech_Ultimate_Ears_Boom_Wireless_Speaker_Night_Black` shown as "black speaker"
  - `Crosley_Alarm_Clock_Vintage_Metal` shown as "alarm clock"
  - `Mens_Striper_Sneaker_in_White_rnp8HUli59Y` shown as "white sneaker"
  - `Timberland_Mens_Classic_2Eye_Boat_Shoe` shown as "brown shoe"
  - `Sapota_Threshold_4_Ceramic_Round_Planter_Red` shown as "red planter"
  - `Ecoforms_Plant_Pot_GP9AAvocado` shown as "green flowerpot"
  - `Great_Dinos_Triceratops_Toy` shown as "toy dinosaur"
  - `Schleich_Lion_Action_Figure` shown as "toy lion"
  - `Schleich_African_Black_Rhino` shown as "toy rhino"
  - `Shurtape_Tape_Purple_CP28` shown as "purple tape roll"
  - `3M_Vinyl_Tape_Green_1_x_36_yd` shown as "green tape roll"
  - `Vans_Cereal_Honey_Nut_Crunch_11_oz_box` shown as "cereal box"
  - `Olive_Kids_Dinosaur_Land_Lunch_Box` shown as "lunch box"
  - `Victor_Reversible_Bookend` shown as "bookend"
  - `Android_Figure_Panda` shown as "panda figure"
  - `Spritz_Easter_Basket_Plastic_Teal` shown as "teal basket"
  - `Ecoforms_Plant_Bowl_Turquoise_7` shown as "turquoise plant bowl"
