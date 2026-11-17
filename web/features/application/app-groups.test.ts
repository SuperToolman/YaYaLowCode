import {expect,it} from "vitest";
import {groupApplications} from "./app-groups";
import type {AppItem} from "./types";
const app=(id:string,extra:Partial<AppItem>={}):AppItem=>({id,name:id,desc:"",icon:"",color:"primary",owner:"",createdAt:"",records:0,deploymentType:"local",...extra});
it("keeps source applications local and isolates overlapping suites by installation",()=>{
 const result=groupApplications([app("source",{onlineVersion:"1.0.0"}),app("single",{deploymentType:"online",marketApplicationType:"single"}),app("b1",{deploymentType:"online",marketApplicationType:"suite",marketInstallationId:"one",marketProductName:"同名套件"}),app("c1",{deploymentType:"online",marketApplicationType:"suite",marketInstallationId:"one",marketProductName:"同名套件"}),app("b2",{deploymentType:"online",marketApplicationType:"suite",marketInstallationId:"two",marketProductName:"同名套件"})]);
 expect(result.local.map(a=>a.id)).toEqual(["source"]);expect(result.purchased.map(a=>a.id)).toEqual(["single"]);
 expect(result.suites.map(g=>g.apps.map(a=>a.id))).toEqual([["b1","c1"],["b2"]]);
});
