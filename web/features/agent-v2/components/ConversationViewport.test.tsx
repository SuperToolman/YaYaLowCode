import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ConversationViewport } from "./ConversationViewport";

vi.mock("@heroui/react",()=>({
  ScrollShadow:forwardRef<HTMLDivElement,HTMLAttributes<HTMLDivElement>>(function MockScrollShadow(props,ref){return <div {...props} ref={ref}/>;}),
  Button:({onPress,isDisabled,children}:{onPress:()=>void;isDisabled:boolean;children:ReactNode})=><button disabled={isDisabled} onClick={onPress}>{children}</button>,
}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

it("opens at the latest message, preserves history position and stops following after scrolling up",()=>{
  vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
  let height=700;
  vi.spyOn(HTMLElement.prototype,"scrollHeight","get").mockImplementation(()=>height);
  vi.spyOn(HTMLElement.prototype,"clientHeight","get").mockReturnValue(200);
  const load=vi.fn();
  const props={loaded:false,hasOlder:true,loadingOlder:false,onLoadOlder:load};
  const {rerender}=render(<ConversationViewport {...props}>latest</ConversationViewport>);
  const viewport=screen.getByLabelText("会话消息");
  rerender(<ConversationViewport {...props} loaded>latest</ConversationViewport>);
  expect(viewport.scrollTop).toBe(700);
  viewport.scrollTop=100;fireEvent.scroll(viewport);
  fireEvent.click(screen.getByRole("button",{name:"查看更早的消息"}));
  expect(load).toHaveBeenCalledOnce();
  rerender(<ConversationViewport {...props} loaded loadingOlder>latest</ConversationViewport>);
  height=1000;
  rerender(<ConversationViewport {...props} loaded>older latest</ConversationViewport>);
  expect(viewport.scrollTop).toBe(400);
  height=1100;
  rerender(<ConversationViewport {...props} loaded>older latest streaming</ConversationViewport>);
  expect(viewport.scrollTop).toBe(400);
});
