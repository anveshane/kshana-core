# Artifact Registry in project.json

## Problem
The itemId → asset mapping is implicit, scattered across executor node state. `executeShotVideo` has to crawl the graph to find matching images. The rewiring bug caused all shots to use the same image because the graph didn't guarantee 1:1 matching.

## Solution
Populate `project.json.artifacts` as a centralized registry when nodes complete:

```json
{
  "artifacts": {
    "shot_image:scene_1_shot_1": {
      "type": "shot_image",
      "itemId": "scene_1_shot_1",
      "outputPath": "assets/images/xxx.png",
      "sourceRefs": ["character_image:parvati", "setting_image:sports_complex"],
      "completedAt": 1774497900764
    }
  }
}
```

## Benefits
- Explicit, inspectable contract between nodes
- No graph crawling — direct lookup by ID
- Source of truth for asset resolution (not executor node state)
- Survives graph rewiring — the mapping is in the registry, not in dependency arrays
- Enables redo: know exactly which assets to regenerate

## Implementation
- On `markCompleted`, write to `artifacts` registry
- `executeShotVideo` looks up `artifacts["shot_image:scene_1_shot_1"]` instead of crawling deps
- `executeShotImage` looks up `artifacts["shot_image_prompt:scene_1_shot_1"]` for prompt JSON
- The registry replaces all `getNode(matchingId).outputPath` patterns
