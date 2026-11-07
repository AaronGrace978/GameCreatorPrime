# Image-to-3D assets

The **Assets** workspace adds a dedicated image-to-3D pipeline alongside the existing world-script agent. It connects to `services/hunyuan/server.py`, which runs the official Hunyuan3D 2.1 geometry and PBR texture models. No hosted provider key is required. The repository's license is unchanged. Model weights and upstream software retain their own licenses; this integration does not relicense or bundle them.

This is an initial integration, not demonstrated Meshy parity. The desktop workflow, model validation, HTTP contract, and Blender import have been tested in the cloud. Neural inference and CPU offloading have **not** been exercised on an NVIDIA GPU in this environment. Passing the health check confirms the adapter is running, not that the models fit in VRAM.

## Aaron's Windows machine

The Ryzen 7 3700X, 32 GB RAM, and RTX 5060 Ti with 16 GB VRAM can be used for local experiments. Hunyuan3D 2.1 documents roughly 10 GB VRAM for geometry and 21 GB for texture generation. Sixteen GB is below the documented texture requirement. The adapter frees the geometry process before loading the texture process and offers CPU offloading; this reduces model residency but does not guarantee that texture activations fit. Begin with **Balanced**. Close other GPU applications. If texturing runs out of memory, the request fails visibly. Use a larger GPU for that run rather than accepting a lower-quality substitute.

Run the Electron app on Windows and the model backend in WSL2 Linux. Windows-to-WSL localhost forwarding normally lets the app reach `http://127.0.0.1:8081`. Use Python 3.10 for the upstream dependencies. Allow space for a separate virtualenv, CUDA tools, downloaded model weights, and scratch exports; model downloads can consume tens of GB.

The RTX 50 series uses Blackwell. Hunyuan's older PyTorch 2.5.1/CUDA 12.4 example predates it. Choose an official PyTorch build supporting Blackwell (PyTorch 2.7 or newer with CUDA 12.8 or newer) from the [PyTorch installer](https://pytorch.org/get-started/locally/). CUDA extensions also need a matching toolkit with Blackwell support. Do not downgrade to the upstream example solely to satisfy a version pin. Updating PyTorch may expose upstream dependency issues, so run the doctor below before downloading or loading the full models.

## Prepare the upstream runtime

Use the [official Hunyuan3D-2.1 installation guide](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1#-get-started-with-hunyuan3d-21) in a separate checkout and virtualenv on your GPU machine. Install its model dependencies, custom rasterizer, differentiable renderer, and Real-ESRGAN checkpoint. Keep package/TLS verification enabled. Record the upstream Git commit and model revisions for benchmark runs. The adapter was implemented against the public `main` API; compatibility with other revisions must be checked.

The upstream native extensions and older image dependencies may need changes to support a current Blackwell/PyTorch toolchain. For example, a `torchvision.transforms.functional_tensor` import failure comes from older BasicSR code against newer torchvision, not a missing GPU. Resolve it in the separate upstream environment using compatible maintained dependencies. This project does not silently patch installed packages, suppress import failures, or claim those combinations have been validated.

With that virtualenv active, run the following in WSL, substituting your actual paths:

```bash
python /path/to/GameCreatorPrime/services/hunyuan/doctor.py \
  --hunyuan-root /path/to/Hunyuan3D-2.1

python /path/to/GameCreatorPrime/services/hunyuan/server.py \
  --hunyuan-root /path/to/Hunyuan3D-2.1 \
  --memory-mode offload --port 8081
```

The doctor executes a CUDA matrix multiplication and imports the generation dependencies. It does not download weights or prove full generation fits. `--memory-mode standard` keeps each stage on the GPU and is intended for machines with more VRAM. Offload mode uses upstream Accelerate/Diffusers hooks and keeps the texture upscaler on the CPU. It is slower and requires host RAM; monitor both system and GPU memory on a 32 GB machine.

The server binds only to loopback and serves one GPU job at a time. For a remote GPU, use authenticated TLS termination or a loopback SSH tunnel; the adapter itself is not a public authenticated service. The desktop permits HTTP only on loopback and HTTPS for remote URLs. Do not expose the model server directly to the Internet.

## Use the workbench

The Windows installer includes the adapter scripts and this guide under its `resources` folder. In **Assets → Generation server**, use **Backend files** and **GPU setup guide** to locate them. Python, CUDA, the upstream Hunyuan checkout, and model weights are installed separately. When running the adapter in WSL, use the corresponding `/mnt/c/...` path to the installed scripts, or copy the adapter folder into your WSL home directory.

1. Start `npm run dev` on the Windows desktop and open **Assets**.
2. Expand **Generation server**, save the backend URL, and check the connection.
3. Choose a PNG/JPEG/WebP reference with one clearly visible object, at least 256 pixels on each side. A transparent background helps preserve the intended silhouette; opaque references go through the upstream background remover.
4. Choose **Balanced** (30 geometry steps, 256 octree, 6 texture views at 512 diffusion resolution) or **Hero asset** (50 steps, 384 octree, 9 views at 768). These are model settings, not promised quality scores. Texture atlases use the upstream paint configuration; diffusion resolution and final atlas resolution are different.
5. Generate. Every attempt retains its reference, requested seed/settings, original GLB, SHA-256, and inspection report under the app's world library `assets/<id>`. The seed controls geometry; upstream texture diffusion has its own fixed seed. Identical results across GPU/toolchain/model revisions are not guaranteed.
6. Orbit the model, including its underside. Review triangles, UVs, embedded textures, and material warnings. A textured triangle is not proof of good topology or correct hidden surfaces.
7. Export the original GLB or prepare `asset.blend`, which packs textures and adds a studio camera and lights while retaining imported geometry and materials. Further cleanup, retopology, LODs, collision, and scale validation remain artist work.

You can also import an existing self-contained, uncompressed triangle GLB. External buffer/image references and unsupported sparse geometry accessors are rejected. Base-color data-URI images and binary embedded images are supported. Importing does not prove that the file was produced by this model.

Generation has a 30-minute client timeout. Cancelling stops the local request and prevents accepting a late result; it does not currently interrupt a running GPU stage. The backend remains busy until that computation exits. A restarted desktop marks unfinished local attempts interrupted. Retry creates a separate version and leaves previous originals intact.

## Quality benchmark before expanding scope

Use the same reference images for GameCreatorPrime and the comparison tool. Start with a hard-surface prop, an organic object, a thin structure, and an asymmetric object with visible back-side requirements. Retain raw outputs, model/checkpoint revisions, requested parameters, hardware, elapsed time, peak VRAM, and licensing terms. Compare silhouette from several angles, hidden surfaces, material consistency under different lights, UV seams, mesh defects, and game-export usability. Do not infer equivalence from the preview alone. Text-to-reference, multi-image conditioning, automatic retopology, and rigging are future work.

## Development validation

```bash
npm test
npm exec tsc -- -b
npm run build
python3 -m unittest discover -s services/hunyuan -p 'test_*.py'
```

These cover the desktop/backend contract and saved asset lifecycle. They use explicit test fixtures for model responses and do not test neural output quality. Real inference requires the GPU runtime described above.
