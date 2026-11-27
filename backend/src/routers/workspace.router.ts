import { z } from "zod";
import { createRouter } from "../lib/router";
import { send } from "../lib/http";
import { paginationQuery, pageParams, pageMeta, escapeRegex } from "../lib/pagination";
import { Exam } from "../models/exam.model";
import { Question } from "../models/question.model";
import { User } from "../models/user.model";
import { Dispute } from "../models/dispute.model";
import { jobsQueue } from "../queues/jobs.queue";
import { audit } from "../services/audit.service";
import { AppError } from "../utils/errors";
const r = createRouter("Workspace");
r.get("/disputes", {summary:"Authorized dispute inbox",access:["EXAMINER","ADMIN"],query:z.object({...paginationQuery,status:z.string().optional()}).strict()}, async(req,res)=>{
 const p=pageParams(req.query as never);
 const examIds=req.user!.role==="ADMIN" ? undefined : await Exam.distinct("_id",{$or:[{ownerId:req.user!.userId},{coExaminerIds:req.user!.userId}]});
 const filter={...(examIds ? {examId:{$in:examIds}} : {}),...(req.query.status ? {status:req.query.status} : {})};
 const [rows,total]=await Promise.all([Dispute.find(filter).sort({slaDueAt:1}).skip(p.skip).limit(p.pageSize).lean(),Dispute.countDocuments(filter)]);
 send(res,rows.map(row=>({...row,id:String(row._id)})),{meta:pageMeta(p,total)});
});
r.get("/search",{summary:"Search authorized workspace records",access:["EXAMINER","ADMIN"],query:z.object({q:z.string().min(2).max(100)}).strict()},async(req,res)=>{
 const rx=new RegExp(escapeRegex(String(req.query.q)),"i");
 const owner=req.user!.role==="ADMIN" ? {} : {ownerId:req.user!.userId};
 const [exams,questions,users]=await Promise.all([Exam.find({...owner,title:rx}).limit(10).lean(),Question.find({...owner,stem:rx}).limit(10).lean(),req.user!.role==="ADMIN" ? User.find({$or:[{fullName:rx},{email:rx}]}).limit(10).lean() : []]);
 send(res,[...exams.map(e=>({id:String(e._id),title:e.title,url:`/studio/exams/${e._id}`})),...questions.map(q=>({id:String(q._id),title:q.stem,url:"/studio/questions"})),...users.map(u=>({id:String(u._id),title:u.fullName,url:`/admin/users/${u._id}`}))]);
});
r.get("/admin/system",{summary:"System version and queue status",access:["ADMIN"]},async(_req,res)=>send(res,{apiVersion:"1.0.0",buildVersion:process.env.BUILD_VERSION ?? "development",status:"running"}));
r.get("/admin/system/queues",{summary:"Background queue counts",access:["ADMIN"]},async(_req,res)=>send(res,[{id:"jobs",name:"jobs",...await jobsQueue.getJobCounts("waiting","active","failed")} ]));
r.post("/admin/jobs/:id/retry",{summary:"Retry a failed job",access:["ADMIN"],params:z.object({id:z.string().min(1).max(100)})},async(req,res)=>{
 const job=await jobsQueue.getJob(String(req.params.id));
 if(!job || await job.getState()!=="failed") throw new AppError(409,"CONFLICT","This job is not eligible for retry");
 await job.retry(); await audit({action:"job.retry",entityType:"job",entityId:String(req.params.id)}); send(res,{retried:true});
});
export default r.router;
