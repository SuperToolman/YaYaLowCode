import { NextResponse } from "next/server";

import { sendSmsCode } from "@lib/http";
import { createBackendSdkClient } from "@lib/backend-client";
import { sdkJsonResponse } from "../../../_lib/backend-sdk-client";

export async function POST(request: Request) {
  let body: { mobile?: string };
  try { body = await request.json() as { mobile?: string }; } catch { return error("请求参数格式不正确", 400); }
  const mobile = body.mobile?.trim() ?? "";
  if (!mobile) return error("请输入手机号", 400);
  return sdkJsonResponse(sendSmsCode({ client: createBackendSdkClient(request), body: { mobile } }));
}

function error(message: string, status: number) { return NextResponse.json({ code: status, message, data: null }, { status }); }
