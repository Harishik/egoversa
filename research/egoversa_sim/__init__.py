"""EgoVersa-Sim: physics-grounded spatial reasoning scenes in MuJoCo.

Scenes are generated from a seed, settled under gravity, and then interrogated with MuJoCo itself as an
exact verifier: camera and observer frames from body poses, visibility from segmentation renders, support
relations from contact forces, and counterfactual outcomes from forward simulation.

Rendering needs an OpenGL context. On macOS set MUJOCO_GL=cgl (default here), on headless Linux MUJOCO_GL=egl.
"""
import os

os.environ.setdefault("MUJOCO_GL", "cgl")

__version__ = "0.5.0"
