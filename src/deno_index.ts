// main.ts

// 根据扩展名返回 content-type
const getContentType = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const types: Record<string, string> = {
    js: "application/javascript",
    css: "text/css",
    html: "text/html",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
  };
  return types[ext] || "text/plain";
};

// --- CORS 包装 ---
function withCORS(resp: Response): Response {
  const newHeaders = new Headers(resp.headers);
  newHeaders.set(
    "Access-Control-Allow-Origin",
    "https://swanedward-zjulian.hf.space", // 允许的前端域名
  );
  newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  newHeaders.set("Access-Control-Allow-Headers", "*");
  return new Response(resp.body, {
    status: resp.status,
    headers: newHeaders,
  });
}

// --- WebSocket 转发 ---
async function handleWebSocket(req: Request): Promise<Response> {
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

  const url = new URL(req.url);
  const targetUrl =
    `wss://generativelanguage.googleapis.com${url.pathname}${url.search}`;

  console.log("Target URL:", targetUrl);

  const pendingMessages: string[] = [];
  const targetWs = new WebSocket(targetUrl);

  targetWs.onopen = () => {
    console.log("Connected to Gemini");
    pendingMessages.forEach((msg) => targetWs.send(msg));
    pendingMessages.length = 0;
  };

  clientWs.onmessage = (event) => {
    console.log("Client message received");
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(event.data);
    } else {
      pendingMessages.push(event.data);
    }
  };

  targetWs.onmessage = (event) => {
    console.log("Gemini message received");
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(event.data);
    }
  };

  clientWs.onclose = (event) => {
    console.log("Client connection closed");
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.close(1000, event.reason);
    }
  };

  targetWs.onclose = (event) => {
    console.log("Gemini connection closed");
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(event.code, event.reason);
    }
  };

  targetWs.onerror = (error) => {
    console.error("Gemini WebSocket error:", error);
  };

  return response; // WebSocket 不需要套 CORS
}

// --- API 请求转发 ---
async function handleAPIRequest(req: Request): Promise<Response> {
  try {
    const worker = await import("./api_proxy/worker.mjs");
    return await worker.default.fetch(req);
  } catch (error) {
    console.error("API request error:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error occurred";
    const errorStatus = (error as { status?: number }).status || 500;
    return new Response(errorMessage, {
      status: errorStatus,
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  }
}

// --- 总请求入口 ---
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  console.log("Request URL:", req.url);

  // 预检请求，直接返回 CORS header
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "https://swanedward-zjulian.hf.space",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  // WebSocket 请求
  if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return handleWebSocket(req);
  }

  let resp: Response;

  // API 请求
  if (
    url.pathname.endsWith("/chat/completions") ||
    url.pathname.endsWith("/embeddings") ||
    url.pathname.endsWith("/models")
  ) {
    resp = await handleAPIRequest(req);
  } else {
    // 静态文件
    try {
      let filePath = url.pathname === "/" || url.pathname === "/index.html"
        ? "/index.html"
        : url.pathname;
      const fullPath = `${Deno.cwd()}/src/static${filePath}`;
      const file = await Deno.readFile(fullPath);
      const contentType = getContentType(filePath);
      resp = new Response(file, {
        headers: { "content-type": `${contentType};charset=UTF-8` },
      });
    } catch {
      resp = new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain;charset=UTF-8" },
      });
    }
  }

  return withCORS(resp);
}

Deno.serve(handleRequest);
