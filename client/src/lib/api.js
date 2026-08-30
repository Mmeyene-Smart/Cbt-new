const TOKEN_KEY="cbt.token";
const USER_KEY="cbt.user";
export const getToken=()=>localStorage.getItem(TOKEN_KEY);
export const getUser=()=>{try{return JSON.parse(localStorage.getItem(USER_KEY))}catch{return null}};
export const setSession=(t,u)=>{localStorage.setItem(TOKEN_KEY,t);localStorage.setItem(USER_KEY,JSON.stringify(u))};
export const clearSession=()=>{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY)};
// Vercel production: set VITE_API_URL in dashboard (e.g., https://your-api.onrender.com)
// Local dev: leave empty to use Vite proxy (/api -> 127.0.0.1:4001)
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export function apiUrl(path){ return API_BASE ? `${API_BASE}${path}` : path; }
export async function api(path,{method="GET",body}={}){
  const headers={};
  if(body && !(body instanceof FormData)) headers["Content-Type"]="application/json";
  const token=getToken();
  if(token) headers.Authorization=`Bearer ${token}`;
  const url = apiUrl(path);
  const res=await fetch(url,{method, headers, body: body instanceof FormData ? body : body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    // Auto-logout on 401 so the user sees the login screen instead of a broken dashboard
    if(res.status===401 && getToken()){
      clearSession();
      // reload to show AuthScreen; use location to avoid React state issues
      if(!path.includes("/api/auth/")) window.location.reload();
    }
    throw new Error(data.error||`Request failed ${res.status}`);
  }
  return data;
}
