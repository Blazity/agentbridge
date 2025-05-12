# AgentBridge Integration Generator CLI

A command-line interface for converting OpenAPI/Swagger specifications to AgentBridge Protocol format.

## Usage

```bash
npx @agent-bridge/cli
pnpm dlx @agent-bridge/cli
bunx @agent-bridge/cli
```

## Options

```
  -V, --version       output the version number
  -o, --output <path> output file path (default: "agentbridge.json")
  --no-cache          disable LLM response caching
  -d, --debug         enable debug mode with detailed output
  -v, --verbose       enable verbose logging with detailed processing information
  -c, --concurrency <number> number of endpoints to process in parallel (default: 3)
  -h, --help          display help for command
```
