import os
from contextlib import asynccontextmanager
from typing import Any, TypedDict

import httpx
from fastapi import FastAPI, Header, HTTPException
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field


class ToolCall(BaseModel):
    id: str
    name: str
    input: dict[str, Any] = Field(default_factory=dict)


class InvokeRequest(BaseModel):
    run_id: str
    session_id: str
    messages: list[dict[str, str]]
    tools: list[dict[str, Any]] = Field(default_factory=list)
    max_tokens: int = 16000
    context: dict[str, str | None] = Field(default_factory=dict)


class InvokeResponse(BaseModel):
    content: str
    tool_calls: list[ToolCall]
    input_tokens: int
    output_tokens: int
    checkpoint_id: str


class GraphState(TypedDict):
    messages: list[dict[str, str]]
    tools: list[dict[str, Any]]
    result: dict[str, Any]
    max_tokens: int




async def model_node(state: GraphState) -> dict[str, Any]:
    base_url = required("AGENT_MODEL_BASE_URL").rstrip("/")
    payload = {
        "model": required("AGENT_MODEL_NAME"),
        "stream": False,
        "messages": state["messages"],
        "tools": state["tools"],
        "tool_choice": "auto" if state["tools"] else "none",
        "max_tokens": state["max_tokens"],
    }
    async with httpx.AsyncClient(timeout=float(os.getenv("LANGGRAPH_MODEL_TIMEOUT_SECONDS", "90"))) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"authorization": f"Bearer {required('AGENT_MODEL_API_KEY')}", "content-type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        body = response.json()
    message = body.get("choices", [{}])[0].get("message", {})
    calls = []
    for call in message.get("tool_calls", []):
        function = call.get("function", {})
        if not function.get("name"):
            continue
        import json
        calls.append({"id": call.get("id", function["name"]), "name": function["name"], "input": json.loads(function.get("arguments") or "{}")})
    usage = body.get("usage", {})
    return {"result": {"content": message.get("content") or "", "tool_calls": calls, "input_tokens": usage.get("prompt_tokens", 0), "output_tokens": usage.get("completion_tokens", 0)}}


graph_builder = StateGraph(GraphState)
graph_builder.add_node("model", model_node)
graph_builder.add_edge(START, "model")
graph_builder.add_edge("model", END)
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncPostgresSaver.from_conn_string(required("LANGGRAPH_CHECKPOINT_DATABASE_URL")) as checkpointer:
        await checkpointer.setup()
        app.state.graph = graph_builder.compile(checkpointer=checkpointer)
        yield


app = FastAPI(title="YaYa LangGraph Worker", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/invoke", response_model=InvokeResponse)
async def invoke(request: InvokeRequest, x_agent_internal_token: str | None = Header(default=None)) -> InvokeResponse:
    expected = required("AGENT_WORKER_INTERNAL_TOKEN")
    if x_agent_internal_token != expected:
        raise HTTPException(status_code=401, detail="internal authentication required")
    result = await app.state.graph.ainvoke(
        {"messages": request.messages, "tools": request.tools, "result": {}, "max_tokens": request.max_tokens},
        {"configurable": {"thread_id": request.run_id, "checkpoint_ns": "agent-workflow"}, "recursion_limit": 4},
    )
    model_result = result["result"]
    return InvokeResponse(**model_result, checkpoint_id=request.run_id)


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value
