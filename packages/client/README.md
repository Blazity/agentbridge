# @agent-bridge/client

A client library for interacting with APIs described by AgentBridge Protocol schemas.

## Installation

```bash
npm install @agent-bridge/client
```

## Usage

### Loading a Schema

You can load a schema from either a local file or a remote URL:

```typescript
import { readSchemaFromFile, fetchSchemaFromUrl } from "@agent-bridge/client";

// From a local file
const localSchema = await readSchemaFromFile("./path/to/agentbridge.json");

// From a remote URL
const remoteSchema = await fetchSchemaFromUrl(
  "https://api.example.com/agentbridge.json"
);
```

### Creating a Client

```typescript
import { AgentBridgeClient, LogLevel } from "@agent-bridge/client";

const client = new AgentBridgeClient(
  schema,
  { apiKey: "your-api-key" },
  LogLevel.INFO
);
```

### Usage with Vercel AI SDK

```typescript
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

// ... code to initialize the client

const { messages } = await req.json();

const { text } = await generateText({
  model: openai("gpt-4o"),
  messages,
  tools: client.getTools(),
});
```

## Logging

The client includes a configurable logging system:

```typescript
// Set log level during initialization
const client = new AgentBridgeClient(schema, credentials, LogLevel.DEBUG);

// Or change it later
client.setLogLevel(LogLevel.TRACE);
```

Available log levels: `NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`
