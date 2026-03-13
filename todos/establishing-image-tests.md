# Establishing Image Pipeline — Test Coverage

Test gaps to cover for the establishing image coherence pipeline.

## 1. parseMotionPrompt validation
- Valid fields parse correctly (multi-shot and legacy formats)
- Invalid `sceneMode` string throws descriptive error
- Missing `establishingImagePath` in multi_shot mode logs warning but does not throw
- Empty `spatialLayout` in multi_shot mode logs warning

## 2. ReadCache
- Cache hit returns cached length when mtime matches
- Cache miss returns null for unknown path
- Stale detection: returns null when mtime has changed
- `evict()` removes entry so next check returns null (file deleted between stat and read)

## 3. ListFilesCache
- TTL expiry: returns null after TTL elapses
- Fresh hit: returns cached result within TTL
- `clear()` invalidates cache immediately

## 4. submitImageGeneration (establishing)
- Filename prefix: `Establishing_Scene${N}` for single pass
- Filename prefix: `Establishing_Scene${N}_pass${P}` for intermediate passes
- Asset type is `establishing_image`
- Context metadata includes `pass`, `totalPasses`, `intermediate` when multi-pass

## 5. parsePromptFile (establishing refs)
- Establishing reference type is parsed correctly from prompt file references

## 6. resolveReferencesToPaths (establishing)
- Fallback to filename scan when artifact ID lookup fails
- Establishing type references resolve correctly

## 7. Continuous mode
- Verify shot image generation is skipped when `sceneMode === 'continuous'`
- Establishing image is used directly as LTX-2 input

## 8. Cascade invalidation
- `markForRegeneration` on establishing image marks downstream shot prompts, scene images, scene videos, and final video as `stale`
- Stale artifacts get 0 progress credit in ProgressTracker
- `getStale()` returns only stale artifacts
- `getSummary()` counts stale artifacts correctly

## 9. Multi-pass establishing generation
- Pass 1 result is saved with `_pass1` suffix
- Pass 2 uses Pass 1 result as image1 reference
- Final pass result has clean `Establishing_Scene${N}` name
