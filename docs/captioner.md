Captioner API Integration Guide

  Base URL: http://192.168.68.105:8090

  ---
  Caption an image

  POST /caption
  Content-Type: multipart/form-data

  ┌──────────────┬────────┬──────────┬─────────────────────────────────────────────────────────────┐
  │    Field     │  Type  │ Required │                         Description                         │
  ├──────────────┼────────┼──────────┼─────────────────────────────────────────────────────────────┤
  │ image        │ file   │ yes      │ JPEG, PNG, WebP, etc.                                       │
  ├──────────────┼────────┼──────────┼─────────────────────────────────────────────────────────────┤
  │ trigger_word │ string │ no       │ LoRA trigger word (e.g. ohwx) — prepended to caption if not │
  │              │        │          │  already present                                            │
  ├──────────────┼────────┼──────────┼─────────────────────────────────────────────────────────────┤
  │ max_tokens   │ int    │ no       │ Default 768                                                 │
  └──────────────┴────────┴──────────┴─────────────────────────────────────────────────────────────┘

  Response:
  {"caption": "Cinematic drama, shallow depth of field..."}

  ---
  Examples

  curl:
  curl -X POST http://192.168.68.105:8090/caption -F "image=@photo.jpg"

  With trigger word:
  curl -X POST http://192.168.68.105:8090/caption \
    -F "image=@photo.jpg" \
    -F "trigger_word=ohwx"

  Python:
  import httpx

  with open("photo.jpg", "rb") as f:
      resp = httpx.post(
          "http://192.168.68.105:8090/caption",
          files={"image": f},
          data={"trigger_word": "ohwx"},
          timeout=120,
      )
  print(resp.json()["caption"])

  JavaScript (fetch):
  const fd = new FormData();
  fd.append("image", fileInput.files[0]);
  fd.append("trigger_word", "ohwx");

  const resp = await fetch("http://192.168.68.105:8090/caption", {
    method: "POST", body: fd
  });
  const { caption } = await resp.json();

  ---
  Other endpoints

  ┌──────────┬────────┬────────────────────────────────────────────┐
  │ Endpoint │ Method │                Description                 │
  ├──────────┼────────┼────────────────────────────────────────────┤
  │ /health  │ GET    │ Returns status of captioner + llama-server │
  ├──────────┼────────┼────────────────────────────────────────────┤
  │ /docs    │ GET    │ Swagger UI (interactive testing)           │
  ├──────────┼────────┼────────────────────────────────────────────┤
  │ /        │ GET    │ Simple web UI for manual captioning        │
  └──────────┴────────┴────────────────────────────────────────────┘

  ---
  Notes
  - Images are auto-resized to max 1024px long side before sending to the model
  - Captions are 120-250 words of LTX-2.3 cinematic prose format
  - The backend model is Gliese 9B (Q4_K_M GGUF) via the llama-server router — first request may be
  slow if the model needs to swap in
  - Timeout is 120 seconds to account for model loading on first request