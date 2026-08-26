import { useCallback, useEffect, useRef, useState } from "react";

export default function useCamera(enabled) {
  const videoElRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState("idle"); // idle | requesting | granted | denied | blocked | error
  const [error, setError] = useState("");

  const setVideoRef = useCallback((node) => {
    videoElRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(()=>{});
    }
  }, []);

  // keep backward compat: expose as videoRef (callback)
  const videoRef = setVideoRef;

  const start = useCallback(async () => {
    void enabled;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("blocked");
      setError("Camera not supported in this browser/context. Use HTTPS or localhost.");
      return;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(()=>{});
      }
      setState("granted");
      setError("");
    } catch (e) {
      const name = e?.name || "";
      if (name === "NotAllowedError") { setState("denied"); setError("Camera permission denied. Enable it in browser settings and retry."); }
      else if (name === "NotFoundError") { setState("error"); setError("No camera found."); }
      else { setState("error"); setError(e.message || "Camera error"); }
    }
  }, [enabled]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current = null;
    if (videoElRef.current) videoElRef.current.srcObject = null;
    setState("idle");
  }, []);

  useEffect(()=>()=>stop(),[stop]);

  // snapshot helper: draws current frame to canvas and returns base64 JPEG
  const capture = useCallback(()=>{
    const video = videoElRef.current;
    if (!video || state!=="granted") return null;
    // ensure video has data
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // skip blank frames (all black)
    return canvas.toDataURL("image/jpeg", 0.6);
  },[state]);

  return { videoRef, state, error, start, stop, capture };
}
