import http from "node:http";

const port = Number(process.env.FAKE_PORT ?? 4097);
const mode = process.env.FAKE_MODE ?? "edit";
const delayMs = Number(process.env.FAKE_DELAY_MS ?? 0);
const model = "eval-model";

function writeUsage(res, usage, extra = {}) {
  res.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-fake",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [],
      usage,
      ...extra,
    })}\n\n`,
  );
}

function sendStream(res, chunks, usage) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.flushHeaders();
  for (const chunk of chunks) {
    res.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-fake",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        ...chunk,
      })}\n\n`,
    );
  }
  if (usage) writeUsage(res, usage);
  res.write("data: [DONE]\n\n");
  res.end();
}

function textResponse(payload, withUsage = true) {
  const usage = withUsage
    ? { prompt_tokens: 121, completion_tokens: 17, total_tokens: 138 }
    : undefined;
  if (payload.stream === false) {
    return {
      id: "chatcmpl-fake",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Implemented the change." },
          finish_reason: "stop",
        },
      ],
      ...(usage ? { usage } : {}),
    };
  }
  return {
    chunks: [
      {
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "Implemented the change." },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ],
    usage,
  };
}

function toolCallResponse(payload) {
  const command = "printf '%s\\n' 'export const value = 2;' > src/value.js";
  const toolCall = {
    index: 0,
    id: "call_fake_1",
    type: "function",
    function: {
      name: "bash",
      arguments: JSON.stringify({ command, description: "Fix value" }),
    },
  };
  const usage = { prompt_tokens: 240, completion_tokens: 28, total_tokens: 268 };

  if (payload.stream === false) {
    return {
      id: "chatcmpl-fake",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [toolCall],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage,
    };
  }

  const { index, ...call } = toolCall;
  return {
    chunks: [
      {
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [{ index, ...call }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
    ],
    usage,
  };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, mode });
    return;
  }

  if (req.method === "GET" && req.url === "/v1/models") {
    sendJson(res, 200, {
      object: "list",
      data: [{ id: model, object: "model", owned_by: "eval" }],
    });
    return;
  }

  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    sendJson(res, 404, { error: { message: "not found" } });
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(res, 400, { error: { message: "invalid json" } });
      return;
    }

    const toolNames = Array.isArray(payload.tools)
      ? payload.tools.map((tool) => tool?.function?.name).filter(Boolean)
      : [];
    const roles = Array.isArray(payload.messages)
      ? payload.messages.map((message) => message?.role)
      : [];
    process.stderr.write(
      `${JSON.stringify({
        mode,
        stream: payload.stream,
        toolNames,
        roles,
        lastMessage: payload.messages?.at(-1)?.role,
      })}\n`,
    );

    if (mode === "auth") {
      sendJson(res, 401, {
        error: {
          message: "invalid api key",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      });
      return;
    }

    if (mode === "forbidden") {
      sendJson(res, 403, {
        error: {
          message: "forbidden",
          type: "permission_error",
          code: "forbidden",
        },
      });
      return;
    }

    if (mode === "model_not_found") {
      sendJson(res, 404, {
        error: {
          message: "model not found",
          type: "invalid_request_error",
          code: "model_not_found",
        },
      });
      return;
    }

    if (mode === "error") {
      sendJson(res, 500, {
        error: { message: "fake upstream failed", type: "server_error" },
      });
      return;
    }

    if (mode === "timeout") {
      // Leave the response open. The adapter must enforce its own deadline.
      return;
    }

    const respond = () => {
      const hasTools = toolNames.length > 0;
      const hasToolResult = roles.some((role) => role === "tool");
      const toolMode = mode === "edit" && hasTools && !hasToolResult;
      const result = toolMode
        ? toolCallResponse(payload)
        : textResponse(payload, mode !== "no_usage");

      if (payload.stream === false) {
        sendJson(res, 200, result);
        return;
      }
      sendStream(res, result.chunks, result.usage);
    };

    if (delayMs > 0) setTimeout(respond, delayMs);
    else respond();
  });
});

server.listen(port, "0.0.0.0", () => {
  process.stderr.write(`fake-openai listening on ${port} mode=${mode}\n`);
});
