import os
import sys

# Injected by the GameCreator Prime runner.
sys.path.insert(0, os.environ.get("GCP_RUNTIME", "."))

from gcp import configure, open_or_reset, write_inspect_json  # noqa: E402

configure(
    project_dir=os.environ["GCP_PROJECT"],
    blend_path=os.environ["GCP_BLEND"],
    render_dir=os.environ["GCP_RENDERS"],
    export_dir=os.environ["GCP_EXPORTS"],
    mode=os.environ.get("GCP_MODE", "generative"),
)
open_or_reset(live=os.path.exists(os.environ["GCP_BLEND"]))
write_inspect_json()
