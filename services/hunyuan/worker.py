"""Run one GPU stage; keep heavyweight imports out of the HTTP server."""
import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("shape", "texture"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--memory-mode", choices=("offload", "standard"), required=True)
    args = parser.parse_args()
    sys.path[:0] = [str(args.root), str(args.root / "hy3dshape"), str(args.root / "hy3dpaint")]
    import torch
    from PIL import Image
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Install a PyTorch build supporting your NVIDIA GPU.")
    config = json.loads((args.job / "request.json").read_text())
    torch.manual_seed(config["seed"])
    image = Image.open(args.job / "reference.png")
    image.load()
    print(f"GCP {args.phase}: {torch.cuda.get_device_name(0)}; settings={config}", flush=True)
    if args.phase == "shape":
        from hy3dshape import Hunyuan3DDiTFlowMatchingPipeline
        from hy3dshape.rembg import BackgroundRemover
        # Preserve authored alpha. Remove the background for opaque references.
        if image.mode != "RGBA" or image.getextrema()[3][0] == 255:
            image = BackgroundRemover()(image.convert("RGB"))
        image.save(args.job / "reference.png")
        shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            "tencent/Hunyuan3D-2.1", device="cpu" if args.memory_mode == "offload" else "cuda")
        if args.memory_mode == "offload":
            shape.enable_model_cpu_offload()
            # This upstream pipeline uses self.device for its sampling tensors,
            # rather than Diffusers' _execution_device. Keep hooks on the modules.
            shape.device = torch.device("cuda")
        mesh = shape(image=image, num_inference_steps=config["num_inference_steps"],
                     octree_resolution=config["octree_resolution"],
                     generator=torch.Generator(device="cuda").manual_seed(config["seed"]))[0]
        mesh.export(str(args.job / "shape.glb"))
    else:
        from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline
        from hy3dpaint.convert_utils import create_glb_with_pbr_materials
        paint_config = Hunyuan3DPaintConfig(config["max_num_view"], config["texture_resolution"])
        paint_config.realesrgan_ckpt_path = str(args.root / "hy3dpaint/ckpt/RealESRGAN_x4plus.pth")
        paint_config.multiview_cfg_path = str(args.root / "hy3dpaint/cfgs/hunyuan-paint-pbr.yaml")
        paint_config.custom_pipeline = str(args.root / "hy3dpaint/hunyuanpaintpbr")
        if args.memory_mode == "offload":
            paint_config.device = "cpu"
        paint = Hunyuan3DPaintPipeline(paint_config)
        if args.memory_mode == "offload":
            multiview = paint.models["multiview_model"]
            multiview.pipeline.enable_model_cpu_offload()
            if hasattr(multiview, "dino_v2"):
                multiview.dino_v2.to("cuda")
            multiview.pipeline.enable_vae_tiling()
        obj = str(args.job / "textured.obj")
        paint(mesh_path=str(args.job / "shape.glb"), image_path=image,
              output_mesh_path=obj, save_glb=False)
        textures = {"albedo": obj.replace(".obj", ".jpg"),
                    "metallic": obj.replace(".obj", "_metallic.jpg"),
                    "roughness": obj.replace(".obj", "_roughness.jpg")}
        for path in textures.values():
            if not Path(path).is_file():
                raise RuntimeError("The texture pass did not produce all PBR maps")
        # The upstream converter uses relative scratch files; isolate those too.
        import os
        os.chdir(args.job)
        create_glb_with_pbr_materials(obj, textures, str(args.job / "textured.glb"))


if __name__ == "__main__":
    main()
