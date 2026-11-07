"""Check the actual GPU kernel and extension imports before downloading models."""
import argparse
import importlib
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hunyuan-root", type=Path, required=True)
    args = parser.parse_args()
    root = args.hunyuan_root.resolve(strict=True)
    sys.path[:0] = [str(root), str(root / "hy3dshape"), str(root / "hy3dpaint")]
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("PyTorch cannot access CUDA. Check the Windows NVIDIA driver and WSL GPU support.")
    capability = torch.cuda.get_device_capability(0)
    # Execute a CUDA kernel: is_available() alone does not prove Blackwell support.
    result = (torch.ones((64, 64), device="cuda") @ torch.ones((64, 64), device="cuda")).sum().item()
    if result != 262144:
        raise RuntimeError("CUDA matrix multiplication returned an unexpected result")
    print(f"GPU: {torch.cuda.get_device_name(0)}; compute capability: {capability}")
    print(f"PyTorch: {torch.__version__}; CUDA runtime: {torch.version.cuda}")
    free, total = torch.cuda.mem_get_info()
    print(f"VRAM free/total: {free / 2**30:.1f}/{total / 2**30:.1f} GiB")
    for module in ("hy3dshape", "textureGenPipeline", "custom_rasterizer", "cupy"):
        importlib.import_module(module)
        print(f"Imported {module}")
    checkpoint = root / "hy3dpaint/ckpt/RealESRGAN_x4plus.pth"
    if not checkpoint.is_file():
        raise RuntimeError(f"Missing upstream texture upscaler checkpoint: {checkpoint}")
    print("Prerequisites passed. Model loading, inference, offloading, and output quality still require a generation run.")


if __name__ == "__main__":
    main()
