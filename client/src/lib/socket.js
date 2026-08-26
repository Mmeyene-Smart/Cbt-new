import { io } from "socket.io-client";
import { getToken } from "./api.js";
let socket=null;
export function getSocket(){
  if(socket) return socket;
  socket=io("/",{auth:{token:getToken()}});
  return socket;
}
export function destroySocket(){ socket?.disconnect(); socket=null; }
