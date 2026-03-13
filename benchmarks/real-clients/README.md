# Real Client Benchmark Data

Drop real benchmark run JSON files into this directory.

Each file can contain either:

- a single JSON object
- or an array of benchmark run objects

Minimum fields per run:

- `client`
- `profile`
- `transport`
- `scenario`
- `success`

Optional fields:

- `clientVersion`
- `model`
- `turnCount`
- `toolCalls`
- `responseModeResults`
- `notes`

Use `npm run summarize:real-benchmarks` to aggregate the collected runs.
