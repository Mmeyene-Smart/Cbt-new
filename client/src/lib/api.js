const TOKEN_KEY="cbt.token";
const USER_KEY="cbt.user";
export const getToken=()=>localStorage.getItem(TOKEN_KEY);
export const getUser=()=>{try{return JSON.parse(localStorage.getItem(USER_KEY))}catch{return null}};
export const setSession=(t,u)=>{localStorage.setItem(TOKEN_KEY,t);localStorage.setItem(USER_KEY,JSON.stringify(u))};
export const clearSession=()=>{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY)};
export async function api(path,{method="GET",body}={}){
  const headers={};
  if(body && !(body instanceof FormData)) headers["Content-Type"]="application/json";
  const token=getToken();
  if(token) headers.Authorization=`Bearer ${token}`;
  const res=await fetch(path,{method, headers, body: body instanceof FormData ? body : body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||`Request failed ${res.status}`);
  return data;
}
