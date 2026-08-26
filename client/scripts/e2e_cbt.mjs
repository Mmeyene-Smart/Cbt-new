import { io } from "socket.io-client";
const API="http://127.0.0.1:4001";
async function api(path, opts={}){ const r=await fetch(API+path, opts); const j=await r.json(); if(!r.ok) throw new Error(JSON.stringify(j)); return j; }
const stu=await api("/api/auth/login",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:"mmeyene",password:"student123"})});
const admin=await api("/api/auth/login",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:"admin",password:"Admin123"})});
console.log("logins ok", stu.user.username, admin.user.username);
const exams=await api("/api/exams",{headers:{Authorization:"Bearer "+stu.token}});
const exam=exams[0];
console.log("exam", exam.title);
const detail=await api(`/api/exams/${exam.id}`,{headers:{Authorization:"Bearer "+stu.token}});
console.log("questions", detail.questions.length);
const start=await api("/api/attempts/start",{method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer "+stu.token}, body:JSON.stringify({examId: exam.id, cameraConsentAt: Date.now()})});
console.log("attempt", start.attemptId);
const firstOpt = Array.isArray(detail.questions[0].options) ? detail.questions[0].options[0] : JSON.parse(detail.questions[0].options)[0];
await api(`/api/attempts/${start.attemptId}/answer`,{method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer "+stu.token}, body:JSON.stringify({questionId: detail.questions[0].id, given: [firstOpt]})});
console.log("answer saved");
// proctor snapshot test
const adminSock=io(API,{auth:{token: admin.token}});
await new Promise(r=> adminSock.on("connect",r));
adminSock.emit("proctor:watch",{}, (res)=> console.log("watch ack",res));
const frameP=new Promise((res,rej)=>{ const t=setTimeout(()=>rej(new Error("timeout frame")),6000); adminSock.once("proctor:frame", (f)=>{clearTimeout(t); res(f);}); });
const stuSock=io(API,{auth:{token: stu.token}});
await new Promise(r=> stuSock.on("connect",r));
// minimal 1x1 JPEG base64 (tiny valid JPEG)
const tinyJpeg="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=";
stuSock.emit("proctor:snapshot",{attemptId: start.attemptId, jpegBase64: tinyJpeg});
const frame=await frameP;
console.log("proctor frame received", frame.username, frame.attemptId, !!frame.url);
const graded=await api(`/api/attempts/${start.attemptId}/submit`,{method:"POST", headers:{Authorization:"Bearer "+stu.token}});
console.log("graded", graded.score+"/"+graded.total, graded.passed?"PASS":"FAIL");
adminSock.close(); stuSock.close();
console.log("E2E OK");
process.exit(0);
