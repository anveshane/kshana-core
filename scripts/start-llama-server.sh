#!/bin/bash
# Launch llama-server with Qwen3-VL-8B model optimized for M1 Pro

MODEL_DIR="/Users/ganaraj.permunda/.lmstudio/models/huihui-ai/Huihui-Qwen3-VL-8B-Instruct-abliterated"
MODEL="${MODEL_DIR}/ggml-model-Q4_K_M.gguf"
PROJECTOR="${MODEL_DIR}/mmproj-model-f16.gguf"

# Speed optimizations for M1 Pro:
# -ngl 99       : Offload all layers to Metal GPU
# --flash-attn  : Flash attention (faster)
# -c 16384      : Context size 16K (~2.3 GB KV cache)
# -b 512        : Batch size
# --cont-batching : Continuous batching for better throughput

echo "Starting llama-server with Qwen3-VL-8B..."
echo "Model: $MODEL"
echo "Projector: $PROJECTOR"
echo ""
echo "API endpoint: http://127.0.0.1:8080/v1"
echo ""

llama-server \
  --model "$MODEL" \
  --mmproj "$PROJECTOR" \
  --host 127.0.0.1 \
  --port 8080 \
  -ngl 99 \
  --flash-attn on \
  -c 16384 \
  -b 512 \
  --cont-batching \
  --chat-template chatml
