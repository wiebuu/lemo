"""Export torchcrepe's "full" model to ONNX for in-browser analysis (web/public/models).

Input: frames [N, 1024] (16 kHz, each frame mean-centred and std-normalised).
Output: probabilities [N, 360] (sigmoid) — exactly what torchcrepe's postprocess gets.
Run: .venv/bin/python tools/export_crepe.py <out.onnx>"""

import sys

import numpy as np
import torch
import torchcrepe

out = sys.argv[1]
torchcrepe.load.model("cpu", "full")
model = torchcrepe.infer.model.eval()
x = torch.randn(64, 1024)
torch.onnx.export(model, (x,), out, input_names=["frames"], output_names=["probs"],
                  dynamic_axes={"frames": {0: "n"}, "probs": {0: "n"}}, opset_version=17, dynamo=False)

import onnxruntime as ort

sess = ort.InferenceSession(out)
a = sess.run(None, {"frames": x.numpy()})[0]
with torch.no_grad():
    b = model(x).numpy()
print("max diff vs torch:", float(np.abs(a - b).max()))
