import { io } from "socket.io-client";
import { getToken } from "./api.js";
let socket=null;
const WS_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") || "/";
export function getSocket(){
  if(socket) return socket;
  // production: VITE_API_URL like https://cbt-api.onrender.com -> socket connects there
  // local: "/" uses Vite proxy (ws://127.0.0.1:4001 via vite.config.js)
  socket=io(WS_URL,{auth:{token:getToken()}, transports:["websocket","polling"]});
  return socket;
}
export function destroySocket(){ socket?.disconnect(); socket=null; }
