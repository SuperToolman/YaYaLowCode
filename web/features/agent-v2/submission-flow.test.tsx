import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "./client";
import { recoveryKey, useSubmissionFlow, type LocalAttachment } from "./submission-flow";
vi.mock("./client",()=>({createSubmission:vi.fn(),getSubmission:vi.fn(),uploadStagedFile:vi.fn(),commitSubmission:vi.fn(),abandonSubmission:vi.fn()}));
const input:api.SubmissionInput={clientRequestId:"request",employeeId:"employee",sessionId:null,text:"整理",attachments:[]};
const queued={sessionId:"session",messageId:"message",commandId:"command",runId:"run"};
const envelope=(body=input):api.Submission=>({id:"submission",payload:body,status:"uploading",expiresAt:"",attachments:body.attachments.map(f=>({clientFileId:f.clientFileId,uploaded:false})),result:null});
function setup(){
 const complete=vi.fn().mockResolvedValue(undefined),error=vi.fn(),restore=vi.fn();
 let saved=envelope();
 vi.mocked(api.createSubmission).mockImplementation(async body=>(saved=envelope(body)));
 vi.mocked(api.getSubmission).mockImplementation(async()=>saved);
 vi.mocked(api.uploadStagedFile).mockImplementation(async(_,fid)=>{saved={...saved,attachments:saved.attachments.map(f=>({...f,uploaded:f.uploaded||f.clientFileId===fid}))};return saved;});
 vi.mocked(api.commitSubmission).mockImplementation(async()=>saved={...saved,status:"committed",result:queued});
 vi.mocked(api.abandonSubmission).mockImplementation(async()=>saved.status==="committed"?saved:{...saved,status:"abandoned"});
 return {complete,error,restore};
}
afterEach(()=>{cleanup();localStorage.clear();vi.resetAllMocks();});
it("does nothing before send and reserves no more than two binary uploads concurrently",async()=>{
 const options=setup();const {result}=renderHook(()=>useSubmissionFlow({userId:"viewer",ready:true,...options}));
 expect(api.createSubmission).not.toHaveBeenCalled();
 const files:LocalAttachment[]=Array.from({length:3},(_,i)=>({id:`f${i}`,name:`${i}.txt`,size:4,file:new File(["test"],`${i}.txt`)}));
 const releases:(()=>void)[]=[];let active=0,max=0;
 vi.mocked(api.uploadStagedFile).mockImplementation(async()=>{active++;max=Math.max(max,active);await new Promise<void>(r=>releases.push(r));active--;return envelope();});
 let send!:Promise<void>;act(()=>{send=result.current.send("employee","","整理",files);});
 await waitFor(()=>expect(releases).toHaveLength(2));expect(api.commitSubmission).not.toHaveBeenCalled();
 await act(async()=>{releases[0]();});await waitFor(()=>expect(releases).toHaveLength(3));
 await act(async()=>{releases[1]();releases[2]();await send;});
 expect(max).toBe(2);expect(options.complete).toHaveBeenCalledWith(queued);
 expect(localStorage.getItem(recoveryKey("viewer"))).toBeNull();
});
it("retries missing uploads with the frozen request and reuses uploads after commit failure",async()=>{
 const options=setup();const {result}=renderHook(()=>useSubmissionFlow({userId:"viewer",ready:true,...options}));
 const files=[{id:"file",name:"test.txt",size:4,file:new File(["test"],"test.txt")}];
 vi.mocked(api.uploadStagedFile).mockRejectedValueOnce(new Error("upload failed"));
 await act(async()=>{await result.current.send("employee","","整理",files);});
 expect(result.current.frozen).toBe(true);expect(api.commitSubmission).not.toHaveBeenCalled();
 vi.mocked(api.commitSubmission).mockRejectedValueOnce(new Error("commit failed"));
 await act(async()=>{await result.current.send("employee","","整理",files);});
 expect(api.uploadStagedFile).toHaveBeenCalledTimes(2);
 await act(async()=>{await result.current.send("employee","","整理",files);});
 expect(api.uploadStagedFile).toHaveBeenCalledTimes(2);expect(api.createSubmission).toHaveBeenCalledTimes(1);
 expect(api.commitSubmission).toHaveBeenCalledTimes(2);expect(options.complete).toHaveBeenCalledTimes(1);
});
it("recovers a committed request without creating another run",async()=>{
 const options=setup();localStorage.setItem(recoveryKey("viewer"),JSON.stringify({input,id:"submission"}));
 vi.mocked(api.getSubmission).mockResolvedValue({...envelope(),status:"committed",result:queued});
 renderHook(()=>useSubmissionFlow({userId:"viewer",ready:true,...options}));
 await waitFor(()=>expect(options.complete).toHaveBeenCalledWith(queued));
 expect(api.commitSubmission).not.toHaveBeenCalled();expect(api.createSubmission).not.toHaveBeenCalled();
 expect(localStorage.getItem(recoveryKey("viewer"))).toBeNull();
});
it("recovers fully uploaded requests and completes their frozen commit",async()=>{
 const options=setup();localStorage.setItem(recoveryKey("viewer"),JSON.stringify({input,id:"submission"}));
 renderHook(()=>useSubmissionFlow({userId:"viewer",ready:true,...options}));
 await waitFor(()=>expect(options.complete).toHaveBeenCalledWith(queued));expect(api.commitSubmission).toHaveBeenCalledExactlyOnceWith("submission");
});
it("restores missing attachments, rejects replacements, and isolates users",async()=>{
 const options=setup();const body={...input,attachments:[{clientFileId:"file",name:"test.txt",size:4,sha256:"0".repeat(64)}]};
 localStorage.setItem(recoveryKey("viewer"),JSON.stringify({input:body,id:"submission"}));
 vi.mocked(api.getSubmission).mockResolvedValue(envelope(body));
 const {result}=renderHook(()=>useSubmissionFlow({userId:"viewer",ready:true,...options}));
 await waitFor(()=>expect(options.restore).toHaveBeenCalled());expect(api.commitSubmission).not.toHaveBeenCalled();
 await expect(result.current.matchFiles([new File(["test"],"test.txt")])).rejects.toThrow("不匹配");
 cleanup();renderHook(()=>useSubmissionFlow({userId:"another-user",ready:true,...options}));
 expect(api.getSubmission).toHaveBeenCalledTimes(1);
});
it("abandon preserves a commit that already won the server race",async()=>{
 const options=setup();const {result}=renderHook(()=>useSubmissionFlow({userId:"viewer",ready:true,...options}));
 vi.mocked(api.commitSubmission).mockRejectedValueOnce(new Error("response lost"));
 await act(async()=>{await result.current.send("employee","","整理",[]);});
 vi.mocked(api.abandonSubmission).mockResolvedValue({...envelope(),status:"committed",result:queued});
 await act(async()=>{await result.current.abandon();});
 expect(options.complete).toHaveBeenCalledWith(queued);expect(result.current.frozen).toBe(false);
});

it("unlocks retry when abandoning an active upload cannot resolve the server state",async()=>{
 const options=setup();const {result}=renderHook(()=>useSubmissionFlow({userId:"viewer",ready:true,...options}));
 const files=[{id:"file",name:"test.txt",size:4,file:new File(["test"],"test.txt")}];
 let release!:()=>void;
 vi.mocked(api.uploadStagedFile).mockImplementation(async()=>{await new Promise<void>(r=>release=r);return envelope();});
 let send!:Promise<void>;act(()=>{send=result.current.send("employee","","整理",files);});
 await waitFor(()=>expect(api.uploadStagedFile).toHaveBeenCalledTimes(1));
 vi.mocked(api.abandonSubmission).mockRejectedValueOnce(new Error("offline"));
 await act(async()=>{await result.current.abandon();});
 expect(result.current.active).toBe(false);expect(result.current.frozen).toBe(true);
 await act(async()=>{release();await send;});
 expect(api.commitSubmission).not.toHaveBeenCalled();
 await act(async()=>{await result.current.abandon();});
 expect(result.current.frozen).toBe(false);
});
