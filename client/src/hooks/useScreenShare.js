import { useCallback, useEffect, useRef, useState } from "react";

export default function useScreenShare() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState("idle"); // idle | requesting | granted | denied | blocked | error
  const [error, setError] = useState("");

  const setVideoRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(()=>{});
    }
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setState("blocked");
      setError("Screen sharing not supported in this browser. Use Chrome/Edge on HTTPS or localhost.");
      return;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(()=>{});
      }
      setState("granted");
      setError("");
      // handle user stopping share via browser UI
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        setState("idle");
        setError("Screen sharing stopped.");
      });
    } catch (e) {
      const name = e?.name || "";
      if (name === "NotAllowedError") { setState("denied"); setError("Screen sharing permission denied. Please allow to continue."); }
      else { setState("error"); setError(e.message || "Screen sharing error"); }
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  }, []);

  useEffect(()=>()=>stop(),[stop]);

  const capture = useCallback(()=>{
    const video = videoRef.current;
    if (!video || state!=="granted") return null;
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.5);
  },[state]);

  return { videoRef: setVideoRef, state, error, start, stop, capture };
}
