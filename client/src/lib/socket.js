import { io } from "socket.io-client";
import { getToken } from "./api.js";
let socket=null;
const WS_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") || "/";
export function getSocket(){
  if(socket) return socket;
  socket=io(WS_URL,{
    auth:{token:getToken()},
    transports:["websocket","polling"],
    reconnection:true,
    reconnectionAttempts:Infinity,
    reconnectionDelay:1000,
    reconnectionDelayMax:5000,
    timeout:10000,
  });
  socket.on("connect_error",(e)=>{
    console.warn("[socket] connect_error:",e.message);
  });
  return socket;
}
export function destroySocket(){ socket?.disconnect(); socket=null; }
