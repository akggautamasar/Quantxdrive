import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Channels from "./Channels";
export default function ChannelsLauncher() {
  const [token,setToken]=useState(()=>localStorage.getItem("ad_token")||""); const [targets,setTargets]=useState([]); const [open,setOpen]=useState(false);
  useEffect(()=>{const tick=()=>setToken(localStorage.getItem("ad_token")||"");tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{if(!token)return;const refresh=()=>setTargets(Array.from(document.querySelectorAll("nav")));refresh();const observer=new MutationObserver(refresh);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect()},[token]);
  if(!token)return null;
  return <>{targets.map((target,i)=>createPortal(<button key={i} onClick={()=>setOpen(true)} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"8px 10px",marginTop:6,borderRadius:10,border:"1px solid #ddd8ff",cursor:"pointer",background:"#f5f3ff",color:"#6c63ff",fontSize:12,fontWeight:800,textAlign:"left"}}><span style={{fontSize:14,width:20,textAlign:"center"}}>📺</span><span style={{flex:1}}>Channels</span><span style={{fontSize:14}}>›</span></button>,target))}{open&&<Channels token={token} onClose={()=>setOpen(false)}/>}</>;
}
