import { NextResponse } from "next/server";
import { fetchWithControl } from "../../../shared/lib/api-request";

export const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8788";

import { backendAuthorizationHeaders } from "../../../shared/lib/backend-authorization";
export { backendAuthorizationHeaders } from "../../../shared/lib/backend-authorization";

export async function proxyBackendJson(
  request: Request,
  path: string,
  method = request.method,
  timeoutMs = 15_000,
) {
  try {
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await request.text() : undefined;
    const hasJsonBody = Boolean(body?.trim());
    const response = await fetchWithControl(`${backendBaseUrl}${path}`, {
      method,
      headers: {
        ...(hasJsonBody ? { "content-type": "application/json" } : {}),
        ...backendAuthorizationHeaders(request),
      },
      body: hasJsonBody ? body : undefined,
      cache: "no-store",
      signal: request.signal,
      timeoutMs,
      bufferResponse: true,
    });
    // Some backend commands legitimately return 204 with an empty body. Do not
    // invoke response.json() for those responses: undici throws on empty JSON
    // and the resulting noisy rejection obscures the original request.
    const responseText = await response.text();
    if (!responseText.trim()) {
      if (response.status === 204 || response.status === 205 || method === "HEAD") return new NextResponse(null, { status: response.status });
      return NextResponse.json({ code: 502, data: null, message: "backend returned empty JSON" }, { status: 502 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        { code: 502, data: null, message: "backend returned invalid JSON", time: new Date().toISOString() },
        { status: 502 },
      );
    }
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { code: 503, data: null, message: "backend unavailable", time: new Date().toISOString() },
      { status: 503 },
    );
  }
}

export async function proxyBackendStream(
  request: Request,
  path: string,
  method = request.method,
) {
  try {
    const response = await fetchWithControl(`${backendBaseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...backendAuthorizationHeaders(request),
      },
      body: await request.text(),
      cache: "no-store",
      signal: request.signal,
      timeoutMs: 15_000,
      bufferResponse: false,
    });
    if (!response.body) {
      return NextResponse.json(
        { code: 502, data: null, message: "backend returned an empty stream" },
        { status: 502 },
      );
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json(
      { code: 503, data: null, message: "backend unavailable", time: new Date().toISOString() },
      { status: 503 },
    );
  }
}

/** Multipart bodies and binary/stream responses bypass the JSON envelope path. */
export async function proxyBackendFile(request: Request, path: string, maxUploadBytes?: number) {
  try {
    const upload = request.method !== "GET" && request.method !== "HEAD";
    const headers = new Headers(backendAuthorizationHeaders(request));
    if (upload && request.headers.get("content-type")) headers.set("content-type", request.headers.get("content-type")!);
    let body: ArrayBuffer | undefined;
    if (upload && maxUploadBytes != null) {
      if (Number(request.headers.get("content-length")) > maxUploadBytes) return NextResponse.json({ message: "文件超过上传限制" }, { status: 413 });
      const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
      if(reader) while(true) {
        const next=await reader.read();if(next.done)break;
        size+=next.value.byteLength;
        if(size>maxUploadBytes){await reader.cancel();return NextResponse.json({message:"文件超过上传限制"},{status:413});}
        chunks.push(next.value);
      }
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}body=bytes.buffer;
    } else if(upload) body=await request.arrayBuffer();
    const response = await fetchWithControl(`${backendBaseUrl}${path}`, {
      method: request.method, headers, body,
      signal: request.signal, cache: "no-store", timeoutMs: upload ? 120_000 : 15_000,
      bufferResponse: false,
    });
    const forwarded = new Headers(response.headers);
    forwarded.set("cache-control", "private, no-store");
    forwarded.set("x-content-type-options", "nosniff");
    return new Response(response.body, { status: response.status, headers: forwarded });
  } catch {
    return NextResponse.json({ code: 503, data: null, message: "backend unavailable" }, { status: 503 });
  }
}
