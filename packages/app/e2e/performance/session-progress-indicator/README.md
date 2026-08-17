# Session Progress Indicator Benchmark

Run the benchmark from `packages/app`:

```sh
bun run bench:session-progress
```

Open `http://127.0.0.1:6007/?count=200` for an equal-count comparison in a balanced 20 × 10 grid. Use the controls to select 200 indicators, 800 indicators, or as many indicators as fit in the viewport. Large legacy counts can block first paint.

The page shows the frame rate and slow frame count. For browser CPU and GPU data, use these Chrome DevTools tools:

- **More tools > Performance monitor** for page CPU use.
- **More tools > Rendering > Frame rendering stats** for frame rate, dropped frames, GPU raster state, and GPU memory.
- **More tools > Rendering > Paint flashing** for repainted areas.
- **More tools > Layers** for compositor layer count and size.
